import { useState } from "react";
import { useStore } from "../store";
import { deletePreset, savePreset, toast } from "../api";
import type { Preset } from "../types";

export function PresetsRail() {
  const presets = useStore((s) => s.presets);
  const presetId = useStore((s) => s.presetId);
  const settings = useStore((s) => s.settings);
  const applyPreset = useStore((s) => s.applyPreset);
  const setPresets = useStore((s) => s.setPresets);
  const setPresetId = useStore((s) => s.setPresetId);
  const railCollapsed = useStore((s) => s.railCollapsed);
  const setRailCollapsed = useStore((s) => s.setRailCollapsed);

  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const groups = new Map<string, Preset[]>();
  presets.forEach((p) => {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  });

  const nameTaken = (name: string) =>
    presets.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());

  function handleApply(p: Preset) {
    applyPreset(p);
    if (p.owned) setNewName(p.name);
  }

  async function handleDelete(p: Preset) {
    if (!confirm(`Delete the "${p.name}" preset?`)) return;
    try {
      const list = await deletePreset(p.name);
      setPresets(list);
      if (presetId === p.id) setPresetId(null);
      toast(`Deleted "${p.name}"`, true);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function handleSave() {
    const name = newName.trim();
    if (!name) {
      toast("Give the preset a name");
      return;
    }
    setSaving(true);
    try {
      const replacing = nameTaken(name);
      const list = await savePreset({
        name,
        group: "My presets",
        note: newNote.trim(),
        settings,
      });
      setPresets(list);
      const saved = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (saved) setPresetId(saved.id);
      setNewName("");
      setNewNote("");
      toast(replacing ? `Updated "${name}"` : `Saved preset "${name}"`, true);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
              <div className="preset-row" key={preset.id}>
                <button
                  className={`preset${presetId === preset.id ? " is-active" : ""}`}
                  onClick={() => handleApply(preset)}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.note}</span>
                </button>
                {preset.owned && (
                  <button
                    className="preset-del"
                    title={`Delete "${preset.name}"`}
                    onClick={() => handleDelete(preset)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="preset-save">
        <p className="preset-save-title">Save current settings</p>
        <input
          type="text"
          value={newName}
          placeholder="Preset name"
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <input
          type="text"
          value={newNote}
          placeholder="Note (optional)"
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        {nameTaken(newName) && (
          <p className="preset-save-hint">
            A preset with this name already exists, saving will replace it.
          </p>
        )}
        <button className="btn btn-small" onClick={handleSave} disabled={saving}>
          {saving ? "Saving\u2026" : "Save preset"}
        </button>
      </div>
    </aside>
  );
}