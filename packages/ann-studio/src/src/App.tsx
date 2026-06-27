import Header from "./components/Header";
import AudioEditor from "./components/AudioEditor";
import RightRail from "./components/RightRail";
import StatusBar from "./components/StatusBar";
import GameProfile from "./components/GameProfile";
import SoundLibrary from "./components/SoundLibrary";
import Settings from "./components/Settings";
import { useStudioStore } from "./store/useStudioStore";

export default function App() {
  const view = useStudioStore((s) => s.view);

  return (
    <div className="h-screen flex flex-col bg-base text-ink overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        {view === "settings" ? (
          <Settings />
        ) : (
          <>
            <SoundLibrary />
            {view === "studio" ? (
              <>
                <main className="flex-1 flex flex-col min-w-0">
                  <AudioEditor />
                </main>
                <RightRail />
              </>
            ) : (
              <GameProfile />
            )}
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
