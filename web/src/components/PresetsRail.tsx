import { useStore } from "../store";

export function PresetsRail() {
  const presets = useStore((s) => s.presets);
  const presetId = useStore((s) => s.presetId);
  const applyPreset = useStore((s) => s.applyPreset);
  const railCollapsed = useStore((s) => s.railCollapsed);
  const setRailCollapsed = useStore((s) => s.setRailCollapsed);

  const groups = new Map<string, typeof presets>();
  presets.forEach((p) => {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  });

  return (
    <aside
      className={`rail${railCollapsed ? " collapsed" : ""}`}
      aria-label="Presets"
    >
      <div className="rail-header">
        <h2 className="rail-title">Presets</h2>
        <button
          className="btn btn-small btn-quiet"
          title="Close presets"
          onClick={() => setRailCollapsed(!railCollapsed)}
        >
          ✕
        </button>
      </div>
      <div className="preset-list">
        {Array.from(groups.entries()).map(([group, items]) => (
          <div key={group}>
            <p className="preset-group-name">{group}</p>
            {items.map((preset) => (
              <button
                key={preset.id}
                className={`preset${presetId === preset.id ? " is-active" : ""}`}
                onClick={() => applyPreset(preset)}
              >
                <strong>{preset.name}</strong>
                <span>{preset.note}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
