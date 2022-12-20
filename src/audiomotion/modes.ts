export default class Modes {
  ctx: CanvasRenderingContext2D
  _bars: any;
  fillAlpha: any
  showPeaks: any
  _barSpacePx: any
  _barSpace: any
  showBgColor: any
  overlay: any


  drawBarsLines(ctx:any, nBars:any, bars:any, interpolate:any, fftData:any, channel:any,
    currentEnergy:any, maxBarHeight:any, useCanvas:any, isLumiBars:any,
    isAlphaBars:any, isOutline:any, fillAlpha:any, isLedDisplay:any, ledPosY:any,
    isRadial:any, width:any, mode:any, showPeaks:any, initialX:any, lineWidth:any,
    analyzerBottom:any, ledHeight:any, finalX:any, radialPoly:any, radialXY:any,
    points:any, mirrorMode:any, ledSpaceH:any, _barSpacePx:any,
    _barSpace:any, showBgColor:any, overlay:any, channelTop:any, channelBottom:any, strokeIf:any) {
    this._bars = bars;
    this.fillAlpha = fillAlpha;
    this.showPeaks = showPeaks
    this._barSpacePx = _barSpacePx
    this._barSpace = _barSpace
    this.showBgColor = showBgColor
    this.overlay = overlay

    for (let i = 0; i < nBars; i++) {

      const bar = this._bars[i],
        { binLo, binHi, ratioLo, ratioHi } = bar;

      let barHeight = Math.max(interpolate(binLo, ratioLo), interpolate(binHi, ratioHi));

      // check additional bins (if any) for this bar and keep the highest value
      for (let j = binLo + 1; j < binHi; j++) {
        if (fftData[j] > barHeight)
          barHeight = fftData[j];
      }

      barHeight /= 255;
      bar.value[channel] = barHeight;
      currentEnergy += barHeight;

      // update bar peak
      if (bar.peak[channel] > 0) {
        bar.hold[channel]--;
        // if hold is negative, it becomes the "acceleration" for peak drop
        if (bar.hold[channel] < 0)
          bar.peak[channel] += bar.hold[channel] / maxBarHeight;
      }

      // check if it's a new peak for this bar
      if (barHeight >= bar.peak[channel]) {
        bar.peak[channel] = barHeight;
        bar.hold[channel] = 30; // set peak hold time to 30 frames (0.5s)
      }

      // if not using the canvas, move earlier to the next bar
      if (!useCanvas)
        continue;

      // set opacity for bar effects
      if (isLumiBars || isAlphaBars)
        ctx.globalAlpha = barHeight;
      else if (isOutline)
        ctx.globalAlpha = this.fillAlpha;

      // normalize barHeight
      if (isLedDisplay) {
        barHeight = ledPosY(barHeight);
        if (barHeight < 0)
          barHeight = 0; // prevent showing leds below 0 when overlay and reflex are active
      }
      else
        barHeight = barHeight * maxBarHeight | 0;

      // invert bar for radial channel 1
      if (isRadial && channel == 1)
        barHeight *= -1;

      // bar width may need small adjustments for some bars, when barSpace == 0
      let adjWidth = width,
        posX = bar.posX;

      // Draw current bar or line segment

      if (mode == 10) {
        // compute the average between the initial bar (i==0) and the next one
        // used to smooth the curve when the initial posX is off the screen, in mirror and radial modes
        const nextBarAvg = i ? 0 : (fftData[this._bars[1].binLo] / 255 * maxBarHeight * (!isRadial || !channel || - 1) + barHeight) / 2;

        if (isRadial) {
          if (i == 0)
            ctx.lineTo(...radialXY(0, (posX < 0 ? nextBarAvg : barHeight), 1));
          // draw line to the current point, avoiding overlapping wrap-around frequencies
          if (posX >= 0) {
            const point = [posX, barHeight];
            ctx.lineTo(...radialXY(...point, 1));
            points.push(point);
          }
        }
        else { // Linear
          if (i == 0) {
            // start the line off-screen using the previous FFT bin value as the initial amplitude
            if (mirrorMode != -1) {
              const prevFFTData = binLo ? fftData[binLo - 1] / 255 * maxBarHeight : barHeight; // use previous FFT bin value, when available
              ctx.moveTo(initialX - lineWidth, analyzerBottom - prevFFTData);
            }
            else
              ctx.moveTo(initialX, analyzerBottom - (posX < initialX ? nextBarAvg : barHeight));
          }
          // draw line to the current point
          // avoid X values lower than the origin when mirroring left, otherwise draw them for best graph accuracy
          if (mirrorMode != -1 || posX >= initialX)
            ctx.lineTo(posX, analyzerBottom - barHeight);
        }
      }
      else {
        if (mode > 0) {
          if (isLedDisplay)
            posX += Math.max(ledSpaceH / 2, this._barSpacePx / 2);
          else {
            if (this._barSpace == 0) {
              posX |= 0;
              if (i > 0 && posX > this._bars[i - 1].posX + width) {
                posX--;
                adjWidth++;
              }
            }
            else
              posX += this._barSpacePx / 2;
          }
        }

        if (isLedDisplay) {
          const x = posX + width / 2;
          // draw "unlit" leds
          if (this.showBgColor && !this.overlay) {
            const alpha = ctx.globalAlpha;
            ctx.beginPath();
            ctx.moveTo(x, channelTop);
            ctx.lineTo(x, analyzerBottom);
            ctx.strokeStyle = '#7f7f7f22';
            ctx.globalAlpha = 1;
            ctx.stroke();
            // restore properties
            ctx.strokeStyle = ctx.fillStyle;
            ctx.globalAlpha = alpha;
          }
          ctx.beginPath();
          ctx.moveTo(x, isLumiBars ? channelTop : analyzerBottom);
          ctx.lineTo(x, isLumiBars ? channelBottom : analyzerBottom - barHeight);
          ctx.stroke();
        }
        else if (posX >= initialX) {
          if (isRadial)
            radialPoly(posX, 0, adjWidth, barHeight, isOutline);
          else {
            const x = posX,
              y = isLumiBars ? channelTop : analyzerBottom,
              w = adjWidth,
              h = isLumiBars ? channelBottom : -barHeight;

            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + h);
            ctx.lineTo(x + w, y + h);
            ctx.lineTo(x + w, y);

            strokeIf(isOutline);
            ctx.fill();
          }
        }
      }

      // Draw peak
      const peak = bar.peak[channel];
      if (peak > 0 && this.showPeaks && !isLumiBars && posX >= initialX && posX < finalX) {
        // choose the best opacity for the peaks
        if (isOutline && lineWidth > 0)
          ctx.globalAlpha = 1;
        else if (isAlphaBars)
          ctx.globalAlpha = peak;

        // render peak according to current mode / effect
        if (isLedDisplay)
          ctx.fillRect(posX, analyzerBottom - ledPosY(peak), width, ledHeight);
        else if (!isRadial)
          ctx.fillRect(posX, analyzerBottom - peak * maxBarHeight, adjWidth, 2);
        else if (mode != 10) // radial - no peaks for mode 10
          radialPoly(posX, peak * maxBarHeight * (!channel || -1), adjWidth, -2);
      }

    } // for ( let i = 0; i < nBars; i++ )
  }

  showFPS(canvasX: any, ctx: any, fps: any, canvas: any) {
    const size = canvasX.height;
    ctx.font = `bold ${size}px sans-serif`;
    ctx.fillStyle = '#0f0';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(fps), canvas.width - size, size * 2);
  }
}