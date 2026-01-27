import { Toaster } from "sonner";
import { HeaderBar } from "./components/HeaderBar";
import { MainPanel } from "./components/MainPanel";
import { Sidebar } from "./components/Sidebar";
import { ConversationProvider } from "./modules/conversation/provider/ConversationProvider";

export default function App() {
  return (
    <ConversationProvider>
      <div className="h-screen flex flex-col gap-4 p-4 overflow-hidden">
        <Toaster richColors theme="dark" position="top-right" />
        <HeaderBar />
        <div className="flex flex-1 min-h-0 gap-4">
          <Sidebar />
          <MainPanel />
        </div>
      </div>
    </ConversationProvider>
  );
}
