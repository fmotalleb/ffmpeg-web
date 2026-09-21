import { useStore } from "../store";

const TABS = [
  "summary",
  "video",
  "audio",
  "subtitles",
  "filters",
  "dimensions",
  "advanced",
  "preview",
];

export function Tabs() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  return (
    <nav className="tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab}
          className={`tab${activeTab === tab ? " is-active" : ""}`}
          role="tab"
          onClick={() => setActiveTab(tab)}
        >
          {tab.charAt(0).toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </nav>
  );
}
