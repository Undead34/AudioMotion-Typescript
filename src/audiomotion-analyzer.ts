/**!
 * audioMotion-analyzer
 * High-resolution real-time graphic audio spectrum analyzer JS module
 *
 * @version 3.6.1
 * @author  Henrique Avila Vianna <hvianna@gmail.com> <https://henriquevianna.com>
 * @license AGPL-3.0-or-later
 */

import { VERSION, C0, HALF_PI, ROOT24, RPM, TAU, defaults, gradients } from "./audiomotion/constants"
import { ConstructorOptions, GradientOptions, Options } from "./audiomotion/types"
import Modes from "./audiomotion/modes"

class AudioMotionAnalyzer {
  /**
   * CONSTRUCTOR
   *
   * @param {object} [container] DOM element where to insert the analyzer; if undefined, uses the document body
   * @param {object} [options]
   * @returns {object} AudioMotionAnalyzer object
   */
  modes: Modes

  constructor(container: HTMLElement, options: ConstructorOptions) {
    this._ready = false;

    // Gradient definitions
    this._gradients = gradients;
    this.modes = new Modes()

    // Set container
    this._container = container || document.body;

    // Make sure we have minimal width and height dimensions in case of an inline container
    this._defaultWidth = this._container.clientWidth || 640;
    this._defaultHeight = this._container.clientHeight || 270;

    // Use audio context provided by user, or create a new one

    let audioCtx: AudioContext | BaseAudioContext;

    if (options.source && options.source instanceof AudioNode) {
      audioCtx = options.source.context
    } else if (options.audioCtx instanceof AudioContext) {
      audioCtx = options.audioCtx
    } else {
      try {
        audioCtx = new window.AudioContext();
      }
      catch (err) {
        throw new AudioMotionError('ERR_AUDIO_CONTEXT_FAIL', 'Could not create audio context. Web Audio API not supported?');
      }
    }

    // make sure audioContext is valid
    if (!audioCtx.createGain)
      throw new AudioMotionError('ERR_INVALID_AUDIO_CONTEXT', 'Provided audio context is not valid');

    // create the analyzer nodes, channel splitter and merger, and gain nodes for input/output connections
    const analyzer = this._analyzer = [audioCtx.createAnalyser(), audioCtx.createAnalyser()];
    const splitter = this._splitter = audioCtx.createChannelSplitter(2);
    const merger = this._merger = audioCtx.createChannelMerger(2);
    this._input = audioCtx.createGain();
    this._output = audioCtx.createGain();

    // initialize sources array and connect audio source if provided in the options
    this._sources = [];
    if (options.source)
      this.connectInput(options.source);

    // connect splitter -> analyzers
    for (const i of [0, 1])
      splitter.connect(analyzer[i], i);

    // connect merger -> output
    merger.connect(this._output);

    // connect output -> destination (speakers)
    this._outNodes = [];
    if (options.connectSpeakers !== false)
      this.connectOutput();

    // initialize object to save energy
    this._energy = { val: 0, peak: 0, hold: 0 };

    // create analyzer canvas
    const canvas = document.createElement('canvas');
    canvas.style.maxWidth = '100%'; // canvas.style = 'max-width: 100%;'; XD
    this._canvasCtx = canvas.getContext('2d');

    // create auxiliary canvases for the X-axis and radial scale labels
    this._scaleX = document.createElement('canvas').getContext('2d');
    this._scaleR = document.createElement('canvas').getContext('2d');

    // set fullscreen element (defaults to canvas)
    this._fsEl = options.fsElement || canvas;

    // Update canvas size on container / window resize and fullscreen events

    // Fullscreen changes are handled quite differently across browsers:
    // 1. Chromium browsers will trigger a `resize` event followed by a `fullscreenchange`
    // 2. Firefox triggers the `fullscreenchange` first and then the `resize`
    // 3. Chrome on Android (TV) won't trigger a `resize` event, only `fullscreenchange`
    // 4. Safari won't trigger `fullscreenchange` events at all, and on iPadOS the `resize`
    //    event is triggered **on the window** only (last tested on iPadOS 14)

    // helper function for resize events
    const onResize = () => {
      if (!this._fsTimeout) {
        // delay the resize to prioritize a possible following `fullscreenchange` event
        this._fsTimeout = window.setTimeout(() => {
          if (!this._fsChanging) {
            this._setCanvas('resize');
            this._fsTimeout = 0;
          }
        }, 60);
      }
    }

    // if browser supports ResizeObserver, listen for resize on the container
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(this._container);
    }

    // listen for resize events on the window - required for fullscreen on iPadOS
    window.addEventListener('resize', onResize);

    // listen for fullscreenchange events on the canvas - not available on Safari
    canvas.addEventListener('fullscreenchange', () => {
      // set flag to indicate a fullscreen change in progress
      this._fsChanging = true;

      // if there is a scheduled resize event, clear it
      if (this._fsTimeout)
        window.clearTimeout(this._fsTimeout);

      // update the canvas
      this._setCanvas('fschange');

      // delay clearing the flag to prevent any shortly following resize event
      this._fsTimeout = window.setTimeout(() => {
        this._fsChanging = false;
        this._fsTimeout = 0;
      }, 60);
    });

    // Resume audio context if in suspended state (browsers' autoplay policy)
    const unlockContext = () => {
      if (audioCtx.state == 'suspended' && audioCtx instanceof AudioContext)
        audioCtx.resume();
      window.removeEventListener('click', unlockContext);
    }
    window.addEventListener('click', unlockContext);

    // initialize internal variables
    this._calcAux();

    // Set configuration options and use defaults for any missing properties
    this._setProps(options, true);

    // add canvas to the container
    if (this.useCanvas)
      this._container.appendChild(canvas);

    // Finish canvas setup
    this._ready = true;
    this._setCanvas('create');
  }

  /**
   * ==========================================================================
   *
   * PUBLIC PROPERTIES GETTERS AND SETTERS
   *
   * ==========================================================================
   */



  /**
   * ==========================================================================
     *
   * PUBLIC METHODS
   *
   * ==========================================================================
   */

  /**
   * Connects an HTML media element or audio node to the analyzer
   *
   * @param {object} an instance of HTMLMediaElement or AudioNode
   * @returns {object} a MediaElementAudioSourceNode object if created from HTML element, or the same input object otherwise
   */
  connectInput(source: HTMLMediaElement | AudioNode) {
    const isHTML = source instanceof HTMLMediaElement;

    if (!(isHTML || source.connect))
      throw new AudioMotionError('ERR_INVALID_AUDIO_SOURCE', 'Audio source must be an instance of HTMLMediaElement or AudioNode');

    if (!(isHTML && this.audioCtx instanceof AudioContext))
      throw new AudioMotionError('ERR_INVALID_AUDIO_SOURCE', 'The audio source must be an AudioNode when you control the AudioContext');

    const node = isHTML ? this.audioCtx.createMediaElementSource(source) : source;
    if (!this._sources.includes(node)) {
      node.connect(this._input);
      this._sources.push(node);
    }

    return node;
  }

  /**
   * Connects the analyzer output to another audio node
   *
   * @param [{object}] an AudioNode; if undefined, the output is connected to the audio context destination (speakers)
   */
  connectOutput(node = this.audioCtx.destination) {
    if (this._outNodes.includes(node))
      return;

    this._output.connect(node);
    this._outNodes.push(node);

    // when connecting the first node, also connect the analyzer nodes to the merger / output nodes
    if (this._outNodes.length == 1) {
      for (const i of [0, 1])
        this._analyzer[i].connect((!this._stereo && !i ? this._output : this._merger), 0, i);
    }
  }

  /**
   * Disconnects audio sources from the analyzer
   *
   * @param [{object|array}] a connected AudioNode object or an array of such objects; if undefined, all connected nodes are disconnected
   */
  disconnectInput(sources: AudioNode | AudioNode[]) {
    if (!sources)
      sources = Array.from(this._sources);
    else if (!Array.isArray(sources))
      sources = [sources];

    for (const node of sources) {
      const idx = this._sources.indexOf(node);
      if (idx >= 0) {
        node.disconnect(this._input);
        this._sources.splice(idx, 1);
      }
    }
  }

  /**
   * Disconnects the analyzer output from other audio nodes
   *
   * @param [{object}] a connected AudioNode object; if undefined, all connected nodes are disconnected
   */
  disconnectOutput(node: AudioNode) {
    if (node && !this._outNodes.includes(node))
      return;

    this._output.disconnect(node);
    this._outNodes = node ? this._outNodes.filter(e => e !== node) : [];

    // if disconnected from all nodes, also disconnect the analyzer nodes so they keep working on Chromium
    // see https://github.com/hvianna/audioMotion-analyzer/issues/13#issuecomment-808764848
    if (this._outNodes.length == 0) {
      for (const i of [0, 1])
        this._analyzer[i].disconnect();
    }
  }

  /**
   * Returns analyzer bars data
     *
   * @returns {array}
   */
  getBars() {
    return Array.from(this._bars, ({ posX, freqLo, freqHi, hold, peak, value }) => ({ posX, freqLo, freqHi, hold, peak, value }));
  }

  /**
   * Returns the energy of a frequency, or average energy of a range of frequencies
   *
   * @param [{number|string}] single or initial frequency (Hz), or preset name; if undefined, returns the overall energy
   * @param [{number}] ending frequency (Hz)
   * @returns {number|null} energy value (0 to 1) or null, if the specified preset is unknown
   */


  getEnergy(startFreq?, endFreq?) {
    if (startFreq === undefined)
      return this._energy.val;

    // if startFreq is a string, check for presets
    if (startFreq != +startFreq) {
      if (startFreq == 'peak')
        return this._energy.peak;

      const presets = {
        bass: [20, 250],
        lowMid: [250, 500],
        mid: [500, 2e3],
        highMid: [2e3, 4e3],
        treble: [4e3, 16e3]
      }

      if (!presets[startFreq])
        return null;

      [startFreq, endFreq] = presets[startFreq];
    }

    const startBin = this._freqToBin(startFreq),
      endBin = endFreq ? this._freqToBin(endFreq) : startBin,
      chnCount = this._stereo + 1;

    let energy = 0;
    for (let channel = 0; channel < chnCount; channel++) {
      for (let i = startBin; i <= endBin; i++)
        energy += this._fftData[channel][i];
    }

    return energy / (endBin - startBin + 1) / chnCount / 255;
  }

  /**
   * Registers a custom gradient
   *
   * @param {string} name
   * @param {object} options
   */
  registerGradient(name, options) {
    if (typeof name !== 'string' || name.trim().length == 0)
      throw new AudioMotionError('ERR_GRADIENT_INVALID_NAME', 'Gradient name must be a non-empty string');

    if (typeof options !== 'object')
      throw new AudioMotionError('ERR_GRADIENT_NOT_AN_OBJECT', 'Gradient options must be an object');

    if (options.colorStops === undefined || options.colorStops.length < 2)
      throw new AudioMotionError('ERR_GRADIENT_MISSING_COLOR', 'Gradient must define at least two colors');

    this._gradients[name] = {
      bgColor: options.bgColor || '#111',
      dir: options.dir,
      colorStops: options.colorStops
    };

    // if the registered gradient is the current one, regenerate it
    if (name == this._gradient)
      this._makeGrad();
  }

  /**
   * Set dimensions of analyzer's canvas
   *
   * @param {number} w width in pixels
   * @param {number} h height in pixels
   */
  setCanvasSize(w, h) {
    this._width = w;
    this._height = h;
    this._setCanvas('user');
  }

  /**
   * Set desired frequency range
   *
   * @param {number} min lowest frequency represented in the x-axis
   * @param {number} max highest frequency represented in the x-axis
   */
  setFreqRange(min, max) {
    if (min < 1 || max < 1)
      throw new AudioMotionError('ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1`);
    else {
      this._minFreq = Math.min(min, max);
      this._maxFreq = Math.max(min, max);
      this._calcBars();
    }
  }

  /**
   * Set custom parameters for LED effect
   * If called with no arguments or if any property is invalid, clears any previous custom parameters
   *
   * @param {object} [params]
   */
  setLedParams(params) {
    let maxLeds, spaceV, spaceH;

    // coerce parameters to Number; `NaN` results are rejected in the condition below
    if (params) {
      maxLeds = params.maxLeds | 0, // ensure integer
        spaceV = +params.spaceV,
        spaceH = +params.spaceH;
    }

    this._ledParams = maxLeds > 0 && spaceV > 0 && spaceH >= 0 ? [maxLeds, spaceV, spaceH] : undefined;
    this._calcLeds();
  }

  /**
   * Shorthand function for setting several options at once
   *
   * @param {object} options
   */
  setOptions(options) {
    this._setProps(options);
  }

  /**
   * Adjust the analyzer's sensitivity
   *
   * @param {number} min minimum decibels value
   * @param {number} max maximum decibels value
   */
  setSensitivity(min, max) {
    for (const i of [0, 1]) {
      this._analyzer[i].minDecibels = Math.min(min, max);
      this._analyzer[i].maxDecibels = Math.max(min, max);
    }
  }

  /**
   * Start / stop canvas animation
   *
   * @param {boolean} [value] if undefined, inverts the current status
   * @returns {boolean} resulting status after the change
   */
  toggleAnalyzer(value) {
    const started = this.isOn;

    if (value === undefined)
      value = !started;

    if (started && !value) {
      cancelAnimationFrame(this._runId);
      this._runId = undefined;
    }
    else if (!started && value) {
      this._frame = this._fps = 0;
      this._time = performance.now();
      this._runId = requestAnimationFrame(timestamp => this._draw(timestamp));
    }

    return this.isOn;
  }

  /**
   * Toggles canvas full-screen mode
   */
  toggleFullscreen() {
    if (this.isFullscreen) {
      if (document.exitFullscreen)
        document.exitFullscreen();
    }
    else {
      const fsEl = this._fsEl;
      if (fsEl.requestFullscreen)
        fsEl.requestFullscreen();
      else if (fsEl.webkitRequestFullscreen)
        fsEl.webkitRequestFullscreen();
    }
  }

  /**
   * ==========================================================================
   *
   * PRIVATE METHODS
   *
   * ==========================================================================
   */

  /**
   * Calculate auxiliary values and flags
   */
  _calcAux() {
    const canvas = this.canvas,
      isRadial = this._radial,
      isDual = this._stereo && !isRadial,
      centerX = canvas.width >> 1;

    this._radius = Math.min(canvas.width, canvas.height) * (this._stereo ? .375 : .125) | 0;
    this._barSpacePx = Math.min(this._barWidth - 1, (this._barSpace > 0 && this._barSpace < 1) ? this._barWidth * this._barSpace : this._barSpace);
    this._isOctaveBands = this._mode % 10 != 0;
    this._isLedDisplay = this._showLeds && this._isOctaveBands && !isRadial;
    this._isLumiBars = this._lumiBars && this._isOctaveBands && !isRadial;
    this._isAlphaBars = this._alphaBars && !this._isLumiBars && this._mode != 10;
    this._isOutline = this._outlineBars && this._isOctaveBands && !this._isLumiBars && !this._isLedDisplay;
    this._maximizeLeds = !this._stereo || this._reflexRatio > 0 && !this._isLumiBars;

    this._channelHeight = canvas.height - (isDual && !this._isLedDisplay ? .5 : 0) >> isDual;
    this._analyzerHeight = this._channelHeight * (this._isLumiBars || isRadial ? 1 : 1 - this._reflexRatio) | 0;

    // channelGap is **0** if isLedDisplay == true (LEDs already have spacing); **1** if canvas height is odd (windowed); **2** if it's even
    // TODO: improve this, make it configurable?
    this._channelGap = isDual ? canvas.height - this._channelHeight * 2 : 0;

    this._analyzerWidth = canvas.width - centerX * (this._mirror != 0);
    this._initialX = centerX * (this._mirror == -1 && !isRadial);
  }

  /**
   * Precalculate the actual X-coordinate on screen for each analyzer bar
   */
  _calcBars() {
    /*
         Since the frequency scale is logarithmic, each position in the X-axis actually represents a power of 10.
         To improve performace, the position of each frequency is calculated in advance and stored in an array.
         Canvas space usage is optimized to accommodate exactly the frequency range the user needs.
         Positions need to be recalculated whenever the frequency range, FFT size or canvas size change.

                                      +-------------------------- canvas --------------------------+
                                      |                                                            |
            |-------------------|-----|-------------|-------------------!-------------------|------|------------|
            1                  10     |            100                  1K                 10K     |           100K (Hz)
         (10^0)              (10^1)   |          (10^2)               (10^3)              (10^4)   |          (10^5)
                                      |-------------|<--- logWidth ---->|--------------------------|
                          minFreq--> 20                   (pixels)                                22K <--maxFreq
                                  (10^1.3)                                                     (10^4.34)
                                   minLog
      */

    const bars = this._bars = []; // initialize object property

    if (!this._ready)
      return;

    // helper functions
    const binToFreq = bin => bin * this.audioCtx.sampleRate / this.fftSize || 1; // returns 1 for bin 0
    const barsPush = (posX, binLo, binHi, freqLo, freqHi, ratioLo, ratioHi) => bars.push({ posX, binLo, binHi, freqLo, freqHi, ratioLo, ratioHi, peak: [0, 0], hold: [0], value: [0] });

    const analyzerWidth = this._analyzerWidth,
      initialX = this._initialX,
      maxFreq = this._maxFreq,
      minFreq = this._minFreq;

    let minLog, logWidth;

    if (this._isOctaveBands) {

      // generate a 11-octave 24-tone equal tempered scale (16Hz to 33kHz)

      /*
        A simple linear interpolation is used to obtain an approximate amplitude value for the desired frequency
        from available FFT data, like so:

        h = hLo + ( hHi - hLo ) * ( f - fLo ) / ( fHi - fLo )
                                 \___________________________/
                                               |
                                             ratio
        where:

        f   - desired frequency
        h   - amplitude of desired frequency
        fLo - frequency represented by the lower FFT bin
        fHi - frequency represented by the higher FFT bin
        hLo - amplitude of fLo
        hHi - amplitude of fHi

        ratio is calculated in advance here, to reduce computational complexity during real-time rendering in the _draw() function
      */

      let temperedScale = [];

      for (let octave = 0; octave < 11; octave++) {
        for (let note = 0; note < 24; note++) {

          const freq = C0 * ROOT24 ** (octave * 24 + note),
            bin = this._freqToBin(freq, 'floor'),
            binFreq = binToFreq(bin),
            nextFreq = binToFreq(bin + 1),
            ratio = (freq - binFreq) / (nextFreq - binFreq);

          temperedScale.push({ freq, bin, ratio });
        }
      }

      // generate the frequency bands according to current analyzer settings

      const steps = [0, 1, 2, 3, 4, 6, 8, 12, 24][this._mode]; // number of notes grouped per band for each mode

      for (let index = 0; index < temperedScale.length; index += steps) {
        let { freq: freqLo, bin: binLo, ratio: ratioLo } = temperedScale[index],             // band start
          { freq: freqHi, bin: binHi, ratio: ratioHi } = temperedScale[index + steps - 1]; // band end

        const nBars = bars.length,
          prevBar = bars[nBars - 1];

        // if the ending frequency is out of range, we're done here
        if (freqHi > maxFreq || binHi >= this.fftSize / 2) {
          prevBar.binHi++;     // add an extra bin to the last bar, to fully include the last valid band
          prevBar.ratioHi = 0; // disable interpolation
          prevBar.freqHi = binToFreq(prevBar.binHi); // update ending frequency
          break;
        }

        // is the starting frequency in the selected range?
        if (freqLo >= minFreq) {
          if (nBars > 0) {
            const diff = binLo - prevBar.binHi;

            // check if we skipped any available FFT bins since the last bar
            if (diff > 1) {
              // allocate half of the unused bins to the previous bar
              prevBar.binHi = binLo - (diff >> 1);
              prevBar.ratioHi = 0;
              prevBar.freqHi = binToFreq(prevBar.binHi); // update ending frequency

              // if the previous bar doesn't share any bins with other bars, no need for interpolation
              if (nBars > 1 && prevBar.binHi > prevBar.binLo && prevBar.binLo > bars[nBars - 2].binHi) {
                prevBar.ratioLo = 0;
                prevBar.freqLo = binToFreq(prevBar.binLo); // update starting frequency
              }

              // start the current bar at the bin following the last allocated bin
              binLo = prevBar.binHi + 1;
            }

            // if the lower bin is not shared with the ending frequency nor the previous bar, no need to interpolate it
            if (binHi > binLo && binLo > prevBar.binHi) {
              ratioLo = 0;
              freqLo = binToFreq(binLo);
            }
          }

          barsPush(0, binLo, binHi, freqLo, freqHi, ratioLo, ratioHi);
        }
      }

      this._barWidth = analyzerWidth / bars.length;

      bars.forEach((bar, index) => bar.posX = initialX + index * this._barWidth);

      minLog = Math.log10(bars[0].freqLo);
      logWidth = analyzerWidth / (Math.log10(bars[bars.length - 1].freqHi) - minLog);
    }
    else {

      // Discrete frequencies modes

      this._barWidth = 1;

      minLog = Math.log10(minFreq);
      logWidth = analyzerWidth / (Math.log10(maxFreq) - minLog);

      const minIndex = this._freqToBin(minFreq, 'floor'),
        maxIndex = this._freqToBin(maxFreq);

      let lastPos = -999;

      for (let i = minIndex; i <= maxIndex; i++) {
        const freq = binToFreq(i), // frequency represented by this index
          pos = initialX + Math.round(logWidth * (Math.log10(freq) - minLog)); // avoid fractionary pixel values

        // if it's on a different X-coordinate, create a new bar for this frequency
        if (pos > lastPos) {
          barsPush(pos, i, i, freq, freq, 0, 0);
          lastPos = pos;
        } // otherwise, add this frequency to the last bar's range
        else if (bars.length) {
          bars[bars.length - 1].binHi = i;
          bars[bars.length - 1].freqHi = freq;
        }
      }
    }

    // save these for scale generation
    this._minLog = minLog;
    this._logWidth = logWidth;

    // update internal variables
    this._calcAux();

    // generate the X-axis and radial scales
    this._createScales();

    // update LED properties
    this._calcLeds();
  }

  /**
   * Calculate attributes for the vintage LEDs effect, based on visualization mode and canvas resolution
   */
  _calcLeds() {
    if (!this._isOctaveBands || !this._ready)
      return;

    // adjustment for high pixel-ratio values on low-resolution screens (Android TV)
    const dPR = this._pixelRatio / (window.devicePixelRatio > 1 && window.screen.height <= 540 ? 2 : 1);

    const params = [[],
    [128, 3, .45], // mode 1
    [128, 4, .225], // mode 2
    [96, 6, .225], // mode 3
    [80, 6, .225], // mode 4
    [80, 6, .125], // mode 5
    [64, 6, .125], // mode 6
    [48, 8, .125], // mode 7
    [24, 16, .125], // mode 8
    ];

    // use custom LED parameters if set, or the default parameters for the current mode
    const customParams = this._ledParams,
      [maxLeds, spaceVRatio, spaceHRatio] = customParams || params[this._mode];

    let ledCount, spaceV,
      analyzerHeight = this._analyzerHeight;

    if (customParams) {
      const minHeight = 2 * dPR;
      let blockHeight;
      ledCount = maxLeds + 1;
      do {
        ledCount--;
        blockHeight = analyzerHeight / ledCount / (1 + spaceVRatio);
        spaceV = blockHeight * spaceVRatio;
      } while ((blockHeight < minHeight || spaceV < minHeight) && ledCount > 1);
    }
    else {
      // calculate vertical spacing - aim for the reference ratio, but make sure it's at least 2px
      const refRatio = 540 / spaceVRatio;
      spaceV = Math.min(spaceVRatio * dPR, Math.max(2, analyzerHeight / refRatio + .1 | 0));
    }

    // remove the extra spacing below the last line of LEDs
    if (this._maximizeLeds)
      analyzerHeight += spaceV;

    // recalculate the number of leds, considering the effective spaceV
    if (!customParams)
      ledCount = Math.min(maxLeds, analyzerHeight / (spaceV * 2) | 0);

    this._leds = [
      ledCount,
      spaceHRatio >= 1 ? spaceHRatio : this._barWidth * spaceHRatio, // spaceH
      spaceV,
      analyzerHeight / ledCount - spaceV // ledHeight
    ];
  }

  /**
   * Generate the X-axis and radial scales in auxiliary canvases
   */
  _createScales() {
    const freqLabels = [16, 31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
      canvas = this._canvasCtx.canvas,
      scaleX = this._scaleX,
      scaleR = this._scaleR,
      canvasX = scaleX.canvas,
      canvasR = scaleR.canvas,
      scaleHeight = Math.min(canvas.width, canvas.height) * .03 | 0; // circular scale height (radial mode)

    // in radial stereo mode, the scale is positioned exactly between both channels, by making the canvas a bit larger than the central diameter
    canvasR.width = canvasR.height = (this._radius << 1) + (this._stereo * scaleHeight);

    const radius = canvasR.width >> 1, // this is also used as the center X and Y coordinates of the circular scale canvas
      radialY = radius - scaleHeight * .7;	// vertical position of text labels in the circular scale

    // helper function
    const radialLabel = (x, label) => {
      const angle = TAU * (x / canvas.width),
        adjAng = angle - HALF_PI, // rotate angles so 0 is at the top
        posX = radialY * Math.cos(adjAng),
        posY = radialY * Math.sin(adjAng);

      scaleR.save();
      scaleR.translate(radius + posX, radius + posY);
      scaleR.rotate(angle);
      scaleR.fillText(label, 0, 0);
      scaleR.restore();
    }

    // clear scale canvas
    canvasX.width |= 0;

    scaleX.fillStyle = scaleR.strokeStyle = '#000c';
    scaleX.fillRect(0, 0, canvasX.width, canvasX.height);

    scaleR.arc(radius, radius, radius - scaleHeight / 2, 0, TAU);
    scaleR.lineWidth = scaleHeight;
    scaleR.stroke();

    scaleX.fillStyle = scaleR.fillStyle = '#fff';
    scaleX.font = `${canvasX.height >> 1}px sans-serif`;
    scaleR.font = `${scaleHeight >> 1}px sans-serif`;
    scaleX.textAlign = scaleR.textAlign = 'center';

    for (const freq of freqLabels) {
      const label = (freq >= 1000) ? `${freq / 1000}k` : freq,
        x = this._logWidth * (Math.log10(freq) - this._minLog);

      if (x >= 0 && x <= this._analyzerWidth) {
        scaleX.fillText(label, this._initialX + x, canvasX.height * .75);
        if (x < this._analyzerWidth) // avoid wrapping-around the last label and overlapping the first one
          radialLabel(x, label);

        if (this._mirror) {
          scaleX.fillText(label, (this._initialX || canvas.width) - x, canvasX.height * .75);
          if (x > 10) // avoid overlapping of first labels on mirror mode
            radialLabel(-x, label);
        }

      }
    }
  }

  /**
   * Redraw the canvas
   * this is called 60 times per second by requestAnimationFrame()
   */
  _draw(timestamp) {
    const ctx = this._canvasCtx,
      canvas = ctx.canvas,
      canvasX = this._scaleX.canvas,
      canvasR = this._scaleR.canvas,
      energy = this._energy,
      mode = this._mode,
      isAlphaBars = this._isAlphaBars,
      isLedDisplay = this._isLedDisplay,
      isLumiBars = this._isLumiBars,
      isOctaveBands = this._isOctaveBands,
      isOutline = this._isOutline,
      isRadial = this._radial,
      isStereo = this._stereo,
      lineWidth = +this.lineWidth, // make sure the damn thing is a number!
      mirrorMode = this._mirror,
      channelHeight = this._channelHeight,
      channelGap = this._channelGap,
      analyzerHeight = this._analyzerHeight,
      analyzerWidth = isRadial ? canvas.width : this._analyzerWidth,
      initialX = this._initialX,
      finalX = initialX + analyzerWidth,
      centerX = canvas.width >> 1,
      centerY = canvas.height >> 1,
      radius = this._radius,
      maxBarHeight = isRadial ? Math.min(centerX, centerY) - radius : analyzerHeight,
      useCanvas = this.useCanvas;


    if (energy.val > 0)
      this._spinAngle += this._spinSpeed * RPM;

    const strokeIf = flag => {
      if (flag && lineWidth) {
        const alpha = ctx.globalAlpha;
        ctx.globalAlpha = 1;
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
    }

    // helper function - convert planar X,Y coordinates to radial coordinates
    const radialXY = (x, y, dir) => {
      const height = radius + y,
        angle = dir * TAU * (x / canvas.width) + this._spinAngle;

      return [centerX + height * Math.cos(angle), centerY + height * Math.sin(angle)];
    }

    // helper function - draw a polygon of width `w` and height `h` at (x,y) in radial mode
    const radialPoly = (x, y, w, h, stroke) => {
      ctx.beginPath();
      for (const dir of (mirrorMode ? [1, -1] : [1])) {
        ctx.moveTo(...radialXY(x, y, dir));
        ctx.lineTo(...radialXY(x, y + h, dir));
        ctx.lineTo(...radialXY(x + w, y + h, dir));
        ctx.lineTo(...radialXY(x + w, y, dir));
      }

      strokeIf(stroke);
      ctx.fill();
    }

    // LED attributes and helper function for bar height calculation
    const [ledCount, ledSpaceH, ledSpaceV, ledHeight] = this._leds || [];
    const ledPosY = height => (height * ledCount | 0) * (ledHeight + ledSpaceV) - ledSpaceV;

    // select background color
    const bgColor = (!this.showBgColor || isLedDisplay && !this.overlay) ? '#000' : this._gradients[this._gradient].bgColor;

    // compute the effective bar width, considering the selected bar spacing
    // if led effect is active, ensure at least the spacing from led definitions
    let width = this._barWidth - (!isOctaveBands ? 0 : Math.max(isLedDisplay ? ledSpaceH : 0, this._barSpacePx));

    // make sure width is integer for pixel accurate calculation, when no bar spacing is required
    if (this._barSpace == 0 && !isLedDisplay)
      width |= 0;

    let currentEnergy = 0;

    const nBars = this._bars.length;

    for (let channel = 0; channel < isStereo + 1; channel++) {

      const channelTop = channelHeight * channel + channelGap * channel,
        channelBottom = channelTop + channelHeight,
        analyzerBottom = channelTop + analyzerHeight - (isLedDisplay && !this._maximizeLeds ? ledSpaceV : 0);

      if (useCanvas) {
        // clear the channel area, if in overlay mode
        // this is done per channel to clear any residue below 0 off the top channel (especially in line graph mode with lineWidth > 1)
        if (this.overlay)
          ctx.clearRect(0, channelTop - channelGap, canvas.width, channelHeight + channelGap);

        // fill the analyzer background if needed (not overlay or overlay + showBgColor)
        if (!this.overlay || this.showBgColor) {
          if (this.overlay)
            ctx.globalAlpha = this.bgAlpha;

          ctx.fillStyle = bgColor;

          // exclude the reflection area when overlay is true and reflexAlpha == 1 (avoids alpha over alpha difference, in case bgAlpha < 1)
          if (!isRadial || channel == 0)
            ctx.fillRect(initialX, channelTop - channelGap, analyzerWidth, (this.overlay && this.reflexAlpha == 1 ? analyzerHeight : channelHeight) + channelGap);

          ctx.globalAlpha = 1;
        }

        // draw dB scale (Y-axis)
        if (this.showScaleY && !isLumiBars && !isRadial) {
          const scaleWidth = canvasX.height,
            fontSize = scaleWidth >> 1,
            mindB = this._analyzer[0].minDecibels,
            maxdB = this._analyzer[0].maxDecibels,
            interval = analyzerHeight / (maxdB - mindB);

          ctx.fillStyle = '#888';
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'right';
          ctx.lineWidth = 1;

          for (let db = maxdB; db > mindB; db -= 5) {
            const posY = channelTop + (maxdB - db) * interval,
              even = (db % 2 == 0) | 0;

            if (even) {
              const labelY = posY + fontSize * (posY == channelTop ? .8 : .35);
              if (mirrorMode != -1)
                ctx.fillText(db, scaleWidth * .85, labelY);
              if (mirrorMode != 1)
                ctx.fillText(db, canvas.width - scaleWidth * .1, labelY);
              ctx.strokeStyle = '#888';
              ctx.setLineDash([2, 4]);
              ctx.lineDashOffset = 0;
            }
            else {
              ctx.strokeStyle = '#555';
              ctx.setLineDash([2, 8]);
              ctx.lineDashOffset = 1;
            }

            ctx.beginPath();
            ctx.moveTo(initialX + scaleWidth * even * (mirrorMode != -1), ~~posY + .5); // for sharp 1px line (https://stackoverflow.com/a/13879402/2370385)
            ctx.lineTo(finalX - scaleWidth * even * (mirrorMode != 1), ~~posY + .5);
            ctx.stroke();
          }
          // restore line properties
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        }

        // set line width and dash for LEDs effect
        if (isLedDisplay) {
          ctx.setLineDash([ledHeight, ledSpaceV]);
          ctx.lineWidth = width;
        }
        else // for outline effect ensure linewidth is not greater than half the bar width
          ctx.lineWidth = isOutline ? Math.min(lineWidth, width / 2) : lineWidth;

        // set selected gradient for fill and stroke
        ctx.fillStyle = ctx.strokeStyle = this._canvasGradient;
      } // if ( useCanvas )

      // get a new array of data from the FFT
      const fftData = this._fftData[channel];
      this._analyzer[channel].getByteFrequencyData(fftData);

      // helper function for FFT data interpolation
      const interpolate = (bin, ratio) => fftData[bin] + (fftData[bin + 1] - fftData[bin]) * ratio;

      // start drawing path (for mode 10)
      ctx.beginPath();

      // store line graph points to create mirror effect in radial mode
      let points = [];

      // draw bars / lines
      this.modes.drawBarsLines(ctx, nBars, this._bars, interpolate, fftData, channel, currentEnergy,
        maxBarHeight, useCanvas, isLumiBars, isAlphaBars,
        isOutline, this.fillAlpha, isLedDisplay, ledPosY, isRadial,
        width, mode, this.showPeaks, initialX, lineWidth,
        analyzerBottom, ledHeight, finalX, radialPoly, radialXY,
        points, mirrorMode, ledSpaceH, this._barSpacePx,
        this._barSpace, this.showBgColor, this.overlay, channelTop, channelBottom, strokeIf)

      // if not using the canvas, move earlier to the next channel
      if (!useCanvas)
        continue;

      // restore global alpha
      ctx.globalAlpha = 1;

      // Fill/stroke drawing path for mode 10
      if (mode == 10) {
        if (isRadial) {
          if (mirrorMode) {
            let p;
            while (p = points.pop())
              ctx.lineTo(...radialXY(...p, -1));
          }
          ctx.closePath();
        }

        if (lineWidth > 0)
          ctx.stroke();

        if (this.fillAlpha > 0) {
          if (isRadial) {
            // exclude the center circle from the fill area
            ctx.moveTo(centerX + radius, centerY);
            ctx.arc(centerX, centerY, radius, 0, TAU, true);
          }
          else { // close the fill area
            ctx.lineTo(finalX, analyzerBottom);
            ctx.lineTo(initialX, analyzerBottom);
          }

          ctx.globalAlpha = this.fillAlpha;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Reflex effect
      if (this._reflexRatio > 0 && !isLumiBars) {
        let posY, height;
        if (this.reflexFit || isStereo) { // always fit reflex in stereo mode
          posY = isStereo && channel == 0 ? channelHeight + channelGap : 0;
          height = channelHeight - analyzerHeight;
        }
        else {
          posY = canvas.height - analyzerHeight * 2;
          height = analyzerHeight;
        }

        // set alpha and brightness for the reflection
        ctx.globalAlpha = this.reflexAlpha;
        if (this.reflexBright != 1)
          ctx.filter = `brightness(${this.reflexBright})`;

        // create the reflection
        ctx.setTransform(1, 0, 0, -1, 0, canvas.height);
        ctx.drawImage(canvas, 0, channelTop, canvas.width, analyzerHeight, 0, posY, canvas.width, height);

        // reset changed properties
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
      }

    } // for ( let channel = 0; channel < isStereo + 1; channel++ ) {

    // Update energy
    energy.val = currentEnergy / (nBars << isStereo);
    if (energy.val >= energy.peak) {
      energy.peak = energy.val;
      energy.hold = 30;
    }
    else {
      if (energy.hold > 0)
        energy.hold--;
      else if (energy.peak > 0)
        energy.peak *= (30 + energy.hold--) / 30; // decay (drops to zero in 30 frames)
    }

    // MOdes
    if (useCanvas) {
      // Mirror effect
      if (mirrorMode && !isRadial) {
        ctx.setTransform(-1, 0, 0, 1, canvas.width - initialX, 0);
        ctx.drawImage(canvas, initialX, 0, centerX, canvas.height, 0, 0, centerX, canvas.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // restore solid lines
      ctx.setLineDash([]);

      // draw frequency scale (X-axis)
      if (this.showScaleX) {
        if (isRadial) {
          ctx.save();
          ctx.translate(centerX, centerY);
          if (this._spinSpeed)
            ctx.rotate(this._spinAngle + HALF_PI);
          ctx.drawImage(canvasR, -canvasR.width >> 1, -canvasR.width >> 1);
          ctx.restore();
        }
        else
          ctx.drawImage(canvasX, 0, canvas.height - canvasX.height);
      }
    }

    // calculate and update current frame rate

    this._frame++;
    const elapsed = timestamp - this._time;

    if (elapsed >= 1000) {
      this._fps = this._frame / (elapsed / 1000);
      this._frame = 0;
      this._time = timestamp;
    }

    if (this.showFPS) {
      this.modes.showFPS(canvasX, ctx, this._fps, canvas)
    }

    // call callback function, if defined
    if (this.onCanvasDraw) {
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle = this._canvasGradient;
      this.onCanvasDraw(this);
      ctx.restore();
    }

    // schedule next canvas update
    this._runId = requestAnimationFrame(timestamp => this._draw(timestamp));
  }

  /**
   * Return the FFT data bin (array index) which represents a given frequency
   */
  _freqToBin(freq, rounding = 'round') {
    const max = this._analyzer[0].frequencyBinCount - 1,
      bin = Math[rounding](freq * this.fftSize / this.audioCtx.sampleRate);

    return bin < max ? bin : max;
  }

  /**
   * Generate currently selected gradient
   */
  _makeGrad() {

    if (!this._ready)
      return;

    const ctx = this._canvasCtx,
      canvas = ctx.canvas,
      isLumiBars = this._isLumiBars,
      gradientHeight = isLumiBars ? canvas.height : canvas.height * (1 - this._reflexRatio * !this._stereo) | 0,
      // for stereo we keep the full canvas height and handle the reflex areas while generating the color stops
      analyzerRatio = 1 - this._reflexRatio,
      initialX = this._initialX;

    // for radial mode
    const centerX = canvas.width >> 1,
      centerY = canvas.height >> 1,
      maxRadius = Math.min(centerX, centerY),
      radius = this._radius;

    const currGradient = this._gradients[this._gradient],
      colorStops = currGradient.colorStops,
      isHorizontal = currGradient.dir == 'h';

    let grad;

    if (this._radial)
      grad = ctx.createRadialGradient(centerX, centerY, maxRadius, centerX, centerY, radius - (maxRadius - radius) * this._stereo);
    else
      grad = ctx.createLinearGradient(...(isHorizontal ? [initialX, 0, initialX + this._analyzerWidth, 0] : [0, 0, 0, gradientHeight]));

    if (colorStops) {
      const dual = this._stereo && !this._splitGradient && !isHorizontal;

      // helper function
      const addColorStop = (offset, colorInfo) => grad.addColorStop(offset, colorInfo.color || colorInfo);

      for (let channel = 0; channel < 1 + dual; channel++) {
        colorStops.forEach((colorInfo, index) => {

          const maxIndex = colorStops.length - 1;

          let offset = colorInfo.pos !== undefined ? colorInfo.pos : index / maxIndex;

          // in dual mode (not split), use half the original offset for each channel
          if (dual)
            offset /= 2;

          // constrain the offset within the useful analyzer areas (avoid reflex areas)
          if (this._stereo && !isLumiBars && !this._radial && !isHorizontal) {
            offset *= analyzerRatio;
            // skip the first reflex area in split mode
            if (!dual && offset > .5 * analyzerRatio)
              offset += .5 * this._reflexRatio;
          }

          // only for split mode
          if (channel == 1) {
            // add colors in reverse order if radial or lumi are active
            if (this._radial || isLumiBars) {
              const revIndex = maxIndex - index;
              colorInfo = colorStops[revIndex];
              offset = 1 - (colorInfo.pos !== undefined ? colorInfo.pos : revIndex / maxIndex) / 2;
            }
            else {
              // if the first offset is not 0, create an additional color stop to prevent bleeding from the first channel
              if (index == 0 && offset > 0)
                addColorStop(.5, colorInfo);
              // bump the offset to the second half of the gradient
              offset += .5;
            }
          }

          // add gradient color stop
          addColorStop(offset, colorInfo);

          // create additional color stop at the end of first channel to prevent bleeding
          if (this._stereo && index == maxIndex && offset < .5)
            addColorStop(.5, colorInfo);
        });
      }
    }

    this._canvasGradient = grad;
  }

  /**
   * Internal function to change canvas dimensions on demand
   */
  _setCanvas(reason: "create" | "fschange" | "lores" | "user" | "resize") {
    // if initialization is not finished, quit
    if (!this._ready)
      return;

    const ctx = this._canvasCtx,
      canvas = ctx.canvas,
      canvasX = this._scaleX.canvas,
      pixelRatio = window.devicePixelRatio / (this._loRes + 1);

    let screenWidth = window.screen.width * pixelRatio,
      screenHeight = window.screen.height * pixelRatio;

    // Fix for iOS Safari - swap width and height when in landscape
    if (Math.abs(window.orientation) == 90 && screenWidth < screenHeight)
      [screenWidth, screenHeight] = [screenHeight, screenWidth];

    const isFullscreen = this.isFullscreen,
      isCanvasFs = isFullscreen && this._fsEl == canvas,
      newWidth = isCanvasFs ? screenWidth : (this._width || this._container.clientWidth || this._defaultWidth) * pixelRatio | 0,
      newHeight = isCanvasFs ? screenHeight : (this._height || this._container.clientHeight || this._defaultHeight) * pixelRatio | 0;

    // set/update object properties
    this._pixelRatio = pixelRatio;
    this._fsWidth = screenWidth;
    this._fsHeight = screenHeight;

    // if canvas dimensions haven't changed, quit
    if (canvas.width == newWidth && canvas.height == newHeight)
      return;

    // apply new dimensions
    canvas.width = newWidth;
    canvas.height = newHeight;

    // update internal variables
    this._calcAux();

    // if not in overlay mode, paint the canvas black
    if (!this.overlay) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, newWidth, newHeight);
    }

    // set lineJoin property for area fill mode (this is reset whenever the canvas size changes)
    ctx.lineJoin = 'bevel';

    // update dimensions of the scale canvas
    canvasX.width = newWidth;
    canvasX.height = Math.max(20 * pixelRatio, Math.min(newWidth, newHeight) / 27 | 0);

    // (re)generate gradient
    this._makeGrad();

    // calculate bar positions and led options
    this._calcBars();

    // detect fullscreen changes (for Safari)
    if (this._fsStatus !== undefined && this._fsStatus !== isFullscreen)
      reason = 'fschange';
    this._fsStatus = isFullscreen;

    // call the callback function, if defined
    if (this.onCanvasResize)
      this.onCanvasResize(reason, this);
  }

  /**
   * Set object properties
   */
  _setProps(options: Options, useDefaults?) {
    // callback functions properties
    const callbacks = ['onCanvasDraw', 'onCanvasResize'];

    // build an array of valid properties; `start` is not an actual property and is handled after setting everything else
    const validProps = Object.keys(defaults).filter(e => e != 'start').concat(callbacks, ['height', 'width']);

    // handle deprecated `showLeds` property
    if (options && options.showLeds !== undefined && options.ledBars === undefined)
      options.ledBars = options.showLeds;

    if (useDefaults || options === undefined)
      options = { ...defaults, ...options }; // merge options with defaults


    for (const prop of Object.keys(options)) {
      if (callbacks.includes(prop) && typeof options[prop] !== 'function') // check invalid callback
        this[prop] = undefined;
      else if (validProps.includes(prop)) // set only valid properties
        this[prop] = options[prop];
    }

    if (options.start !== undefined)
      this.toggleAnalyzer(options.start);
  }

  bgAlpha: number;
  fillAlpha: number;
  useCanvas: boolean;
  showPeaks: boolean;
  showScaleX: boolean;
  showScaleY: boolean;
  reflexAlpha: number;
  reflexBright: number;
  reflexFit: boolean;
  showBgColor: boolean;
  showFPS: boolean;

  public _gradients: { [name: string]: GradientOptions };
  public _ready: boolean;
  public _container: any;
  public _defaultWidth: any;
  public _defaultHeight: any;
  public _analyzer: any;
  public _splitter: any;
  public _merger: any;
  public _input: GainNode;
  public _output: any;
  public _sources: any;
  public _outNodes: Array<AudioDestinationNode | AudioNode>;
  public _energy: any;
  public _canvasCtx: any;
  public _fsEl: any;
  public _fsTimeout: any;
  public _fsChanging: any;
  public _alphaBars: any;
  public _barSpace: any;
  public _fftData: any;
  public _gradient: any;
  public _height: any;
  public _showLeds: any;
  public _loRes: any;
  public _lumiBars: any;
  public _maxFreq: any;
  public _minFreq: any;
  public _mirror: any;
  public _mode: any;
  public _outlineBars: any;
  public _radial: any;
  public _reflexRatio: any;
  public _spinSpeed: any;
  public _spinAngle: any;
  public _splitGradient: any;
  public _stereo: any;
  public _width: any;
  public _fps: any;
  public _fsHeight: any;
  public _fsWidth: any;
  public _isAlphaBars: any;
  public _isLedDisplay: any;
  public _isLumiBars: any;
  public _isOctaveBands: any;
  public _runId: any;
  public _isOutline: any;
  public _pixelRatio: any;
  public _bars: any;
  public _ledParams: any;
  public _frame: any;
  public _time: any;
  public _radius: any;
  public _barSpacePx: any;
  public _barWidth: any;
  public _maximizeLeds: any;
  public _channelHeight: any;
  public _analyzerHeight: any;
  public _channelGap: any;
  public _analyzerWidth: any;
  public _initialX: any;
  public _minLog: any;
  public _logWidth: any;
  public _leds: any;
  public _scaleX: any;
  public _scaleR: any;
  public lineWidth: any;
  public overlay: any;
  public _canvasGradient: any;
  public onCanvasDraw: any;
  public _fsStatus: any;
  public onCanvasResize: any;
  public freqLo: any;
  public binLo: any;
  public ratioLo: any;
  public freqHi: any;
  public binHi: any;
  public ratioHi: any;

  get alphaBars() {
    return this._alphaBars;
  }

  set alphaBars(value) {
    this._alphaBars = !!value;
    this._calcAux();
  }

  get barSpace() {
    return this._barSpace;
  }
  set barSpace(value) {
    this._barSpace = +value || 0;
    this._calcAux();
  }

  get fftSize() {
    return this._analyzer[0].fftSize;
  }
  set fftSize(value) {
    for (const i of [0, 1])
      this._analyzer[i].fftSize = value;
    const binCount = this._analyzer[0].frequencyBinCount;
    this._fftData = [new Uint8Array(binCount), new Uint8Array(binCount)];
    this._calcBars();
  }

  get gradient() {
    return this._gradient;
  }
  set gradient(value) {
    if (!this._gradients.hasOwnProperty(value))
      throw new AudioMotionError('ERR_UNKNOWN_GRADIENT', `Unknown gradient: '${value}'`);

    this._gradient = value;
    this._makeGrad();
  }

  get height() {
    return this._height;
  }
  set height(h) {
    this._height = h;
    this._setCanvas('user');
  }

  get ledBars() {
    return this._showLeds;
  }
  set ledBars(value) {
    this._showLeds = !!value;
    this._calcAux();
  }

  get loRes() {
    return this._loRes;
  }
  set loRes(value) {
    this._loRes = !!value;
    this._setCanvas('lores');
  }

  get lumiBars() {
    return this._lumiBars;
  }
  set lumiBars(value) {
    this._lumiBars = !!value;
    this._calcAux();
    this._calcLeds();
    this._makeGrad();
  }

  get maxDecibels() {
    return this._analyzer[0].maxDecibels;
  }
  set maxDecibels(value) {
    for (const i of [0, 1])
      this._analyzer[i].maxDecibels = value;
  }

  get maxFreq() {
    return this._maxFreq;
  }
  set maxFreq(value) {
    if (value < 1)
      throw new AudioMotionError('ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1`);
    else {
      this._maxFreq = value;
      this._calcBars();
    }
  }

  get minDecibels() {
    return this._analyzer[0].minDecibels;
  }
  set minDecibels(value) {
    for (const i of [0, 1])
      this._analyzer[i].minDecibels = value;
  }

  get minFreq() {
    return this._minFreq;
  }
  set minFreq(value) {
    if (value < 1)
      throw new AudioMotionError('ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1`);
    else {
      this._minFreq = value;
      this._calcBars();
    }
  }

  get mirror() {
    return this._mirror;
  }
  set mirror(value) {
    this._mirror = Math.sign(value) | 0; // ensure only -1, 0 or 1
    this._calcAux();
    this._calcBars();
    this._makeGrad();
  }

  get mode() {
    return this._mode;
  }
  set mode(value) {
    const mode = value | 0;
    if (mode >= 0 && mode <= 10 && mode != 9) {
      this._mode = mode;
      this._calcAux();
      this._calcBars();
      this._makeGrad();
    }
    else
      throw new AudioMotionError('ERR_INVALID_MODE', `Invalid mode: ${value}`);
  }

  get outlineBars() {
    return this._outlineBars;
  }
  set outlineBars(value) {
    this._outlineBars = !!value;
    this._calcAux();
  }

  get radial() {
    return this._radial;
  }
  set radial(value) {
    this._radial = !!value;
    this._calcAux();
    this._calcBars();
    this._makeGrad();
  }

  get reflexRatio() {
    return this._reflexRatio;
  }
  set reflexRatio(value) {
    value = +value || 0;
    if (value < 0 || value >= 1)
      throw new AudioMotionError('ERR_REFLEX_OUT_OF_RANGE', `Reflex ratio must be >= 0 and < 1`);
    else {
      this._reflexRatio = value;
      this._calcAux();
      this._makeGrad();
      this._calcLeds();
    }
  }

  // DEPRECATED - use ledBars instead
  get showLeds() {
    return this.ledBars;
  }
  set showLeds(value) {
    this.ledBars = value;
  }

  get smoothing() {
    return this._analyzer[0].smoothingTimeConstant;
  }
  set smoothing(value) {
    for (const i of [0, 1])
      this._analyzer[i].smoothingTimeConstant = value;
  }

  get spinSpeed() {
    return this._spinSpeed;
  }
  set spinSpeed(value) {
    value = +value || 0;
    if (this._spinSpeed === undefined || value == 0)
      this._spinAngle = -HALF_PI; // initialize or reset the rotation angle
    this._spinSpeed = value;
  }

  get splitGradient() {
    return this._splitGradient;
  }
  set splitGradient(value) {
    this._splitGradient = !!value;
    this._makeGrad();
  }

  get stereo() {
    return this._stereo;
  }
  set stereo(value) {
    this._stereo = !!value;

    // update node connections
    this._input.disconnect();
    this._input.connect(this._stereo ? this._splitter : this._analyzer[0]);
    this._analyzer[0].disconnect();
    if (this._outNodes.length) // connect analyzer only if the output is connected to other nodes
      this._analyzer[0].connect(this._stereo ? this._merger : this._output);

    // update properties affected by stereo
    this._calcAux();
    this._createScales();
    this._calcLeds();
    this._makeGrad();
  }

  get volume() {
    return this._output.gain.value;
  }
  set volume(value) {
    this._output.gain.value = value;
  }

  get width() {
    return this._width;
  }
  set width(w) {
    this._width = w;
    this._setCanvas('user');
  }

  // Read only properties

  get audioCtx() {
    return this._input.context;
  }

  get canvas() {
    return this._canvasCtx.canvas;
  }

  get canvasCtx() {
    return this._canvasCtx;
  }

  get connectedSources() {
    return this._sources;
  }

  get connectedTo() {
    return this._outNodes;
  }

  get energy() { // DEPRECATED - use getEnergy() instead
    return this.getEnergy();
  }

  get fps() {
    return this._fps;
  }

  get fsHeight() {
    return this._fsHeight;
  }

  get fsWidth() {
    return this._fsWidth;
  }

  get isAlphaBars() {
    return this._isAlphaBars;
  }

  get isFullscreen() {
    return (document.fullscreenElement) === this._fsEl;
  }
  get isLedBars() {
    return this._isLedDisplay;
  }
  get isLedDisplay() { // DEPRECATED - use isLedBars instead
    return this.isLedBars;
  }
  get isLumiBars() {
    return this._isLumiBars;
  }
  get isOctaveBands() {
    return this._isOctaveBands;
  }
  get isOn() {
    return this._runId !== undefined;
  }
  get isOutlineBars() {
    return this._isOutline;
  }
  get peakEnergy() { // DEPRECATED - use getEnergy('peak') instead
    return this.getEnergy('peak');
  }
  get pixelRatio() {
    return this._pixelRatio;
  }
  static get version() {
    return VERSION;
  }
}

/* Custom error class */

class AudioMotionError extends Error {
  public name: any;
  public code: any;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AudioMotionError';
    this.code = code;
  }
}

export default AudioMotionAnalyzer