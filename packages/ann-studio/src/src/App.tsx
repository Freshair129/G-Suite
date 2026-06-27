import Toolbar from "./components/Toolbar";
import WaveformViewer from "./components/WaveformViewer";
import ClipList from "./components/ClipList";

export default function App() {
  return (
    <div className="h-screen flex flex-col bg-surface">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <WaveformViewer />
        <ClipList />
      </div>
    </div>
  );
}
