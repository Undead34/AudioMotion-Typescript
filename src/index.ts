import AudioMotion from "./audiomotion-analyzer"

const container = document.getElementById("container");
const audio = document.createElement("audio");
const play = document.getElementById("play");
const pause = document.getElementById("pause");

audio.src = "https://dl.dropboxusercontent.com/s/umi5qyeq5b1y0oz/01.%20%E9%9D%92%E6%98%A5%E3%82%B3%E3%83%B3%E3%83%97%E3%83%AC%E3%83%83%E3%82%AF%E3%82%B9.flac?dl=0"
audio.crossOrigin = "anonymous"

const audioMotion = new AudioMotion(container, {
  source: audio
})

audioMotion.height = 500

play.onclick = () => audio.play()
pause.onclick = () => audio.pause()