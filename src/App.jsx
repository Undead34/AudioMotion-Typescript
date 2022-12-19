import './App.css';
import AudioMotion from './AudioMotion'
let audio = document.createElement("audio");
audio.src = "https://dl.dropboxusercontent.com/s/umi5qyeq5b1y0oz/01.%20%E9%9D%92%E6%98%A5%E3%82%B3%E3%83%B3%E3%83%97%E3%83%AC%E3%83%83%E3%82%AF%E3%82%B9.flac?dl=0"
audio.crossOrigin = "anonymous"

function App() {
  return (
    <div className="App">
      <AudioMotion source={audio} />
      <button onClick={() => audio.play()}>play</button>
      <button onClick={() => audio.pause()}>pause</button>
    </div>
  );
}

export default App;
