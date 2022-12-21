import AudioMotion from "./audiomotion-analyzer"

const container = document.getElementById("container");
const audio = document.createElement("audio");
const play = document.getElementById("play");
const pause = document.getElementById("pause");

audio.src = "https://dl.dropboxusercontent.com/s/1yvllj2dfb0uc85/%E3%81%8D%E3%81%BF%E3%82%82%E6%82%AA%E3%81%84%E4%BA%BA%E3%81%A7%E3%82%88%E3%81%8B%E3%81%A3%E3%81%9F.mp3?dl=0"
audio.crossOrigin = "anonymous"
audio.loop = true;
// let audioCtx = new AudioContext()
// let gain = audioCtx.createGain()
// let media = audioCtx.createMediaElementSource(audio)
// let output = media.connect(gain)

const audioMotion = new AudioMotion(container, {
  source: audio,
  showFPS: true,
  loRes: false,
  alphaBars: true
})

audioMotion.height = 550

play.onclick = () => audio.play()
pause.onclick = () => audio.pause()
