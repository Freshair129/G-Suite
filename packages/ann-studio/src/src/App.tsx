import Header from "./components/Header";
import WaveformViewer from "./components/WaveformViewer";
import ClipList from "./components/ClipList";
import StatusBar from "./components/StatusBar";

export default function App() {
  return (
    <div className="h-screen flex flex-col bg-base text-ink overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 flex flex-col p-5 min-w-0">
          <WaveformViewer />
        </main>
        <ClipList />
      </div>
      <StatusBar />
    </div>
  );
}
