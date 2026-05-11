import { X } from 'lucide-react'
import { useSettings, type UnitSystem, type AngleUnit } from '../contexts/SettingsContext'
import './SettingsPanel.css'

interface SettingsPanelProps {
	isOpen: boolean
	onClose: () => void
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { settings, updateSettings, resetSettings } = useSettings()

	if (!isOpen) return null

  return (
		<div className="settings-overlay" onClick={onClose}>
			<div className="settings-panel" onClick={e => e.stopPropagation()}>
				<div className="settings-header">
					<h2>Settings</h2>
					<button className="close-btn" onClick={onClose} type="button">
						<X size={20} />
					</button>
				</div>

				<div className="settings-content">
              {/* Units Section */}
              <section className="settings-section">
                <h3>Units</h3>
                <div className="setting-row">
                  <label>Unit System</label>
                  <select
                    value={settings.unitSystem}
                    onChange={e => updateSettings({ unitSystem: e.target.value as UnitSystem })}
                  >
                    <option value="imperial">Imperial (ft)</option>
                    <option value="metric">Metric (m)</option>
                  </select>
                </div>
                <div className="setting-row">
                  <label>Decimal Precision</label>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={settings.decimalPrecision}
                    onChange={e => updateSettings({ decimalPrecision: Number(e.target.value) })}
                  />
                </div>
                <div className="setting-row">
                  <label>Angle Unit</label>
                  <select
                    value={settings.angleUnit}
                    onChange={e => updateSettings({ angleUnit: e.target.value as AngleUnit })}
                  >
                    <option value="degrees">Degrees</option>
                    <option value="radians">Radians</option>
                  </select>
                </div>
              </section>

              {/* Grid & Snap Section */}
              <section className="settings-section">
                <h3>Grid & Snap</h3>
                <div className="setting-row">
                  <label>Show Grid</label>
                  <input
                    type="checkbox"
                    checked={settings.showGrid}
                    onChange={e => updateSettings({ showGrid: e.target.checked })}
                  />
                </div>
                <div className="setting-row">
                  <label>Grid Size ({settings.unitSystem === 'imperial' ? 'ft' : 'm'})</label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={settings.gridSize}
                    onChange={e => updateSettings({ gridSize: Number(e.target.value) })}
                  />
                </div>
                <div className="setting-row">
                  <label>Snap to Grid</label>
                  <input
                    type="checkbox"
                    checked={settings.snapToGrid}
                    onChange={e => updateSettings({ snapToGrid: e.target.checked })}
                  />
                </div>
              </section>

              {/* Object Snaps Section */}
              <section className="settings-section">
                <h3>Object Snaps</h3>
                <div className="setting-row">
                  <label>Endpoint</label>
                  <input
                    type="checkbox"
                    checked={settings.snapToEndpoint}
                    onChange={e => updateSettings({ snapToEndpoint: e.target.checked })}
                  />
                </div>
                <div className="setting-row">
                  <label>Midpoint</label>
                  <input
                    type="checkbox"
                    checked={settings.snapToMidpoint}
                    onChange={e => updateSettings({ snapToMidpoint: e.target.checked })}
                  />
                </div>
                <div className="setting-row">
                  <label>Center</label>
                  <input
                    type="checkbox"
                    checked={settings.snapToCenter}
                    onChange={e => updateSettings({ snapToCenter: e.target.checked })}
                  />
                </div>
              </section>

              {/* Display Section */}
              <section className="settings-section">
                <h3>Display</h3>
                <div className="setting-row">
                  <label>Show Axes</label>
                  <input
                    type="checkbox"
                    checked={settings.showAxes}
                    onChange={e => updateSettings({ showAxes: e.target.checked })}
                  />
                </div>
                <div className="setting-row">
                  <label>Show Leg Loads</label>
                  <input
                    type="checkbox"
                    checked={settings.showLegLoads}
                    onChange={e => updateSettings({ showLegLoads: e.target.checked })}
                  />
                </div>
                <div className="setting-row">
                  <label>Shadows</label>
                  <input
                    type="checkbox"
                    checked={settings.enableShadows}
                    onChange={e => updateSettings({ enableShadows: e.target.checked })}
                  />
                </div>
                <div className="setting-row">
                  <label>Anti-aliasing</label>
                  <input
                    type="checkbox"
                    checked={settings.antiAliasing}
                    onChange={e => updateSettings({ antiAliasing: e.target.checked })}
                  />
                </div>
              </section>

              <section className="settings-section">
                <h3>Navigation</h3>
                <div className="setting-row">
                  <label>Invert Up/Down Orbit</label>
                  <input
                    type="checkbox"
                    checked={settings.invertOrbitVertical}
                    onChange={e => updateSettings({ invertOrbitVertical: e.target.checked })}
                  />
                </div>
              </section>

              {/* Autosave Section */}
              <section className="settings-section">
                <h3>Autosave</h3>
                <div className="setting-row">
                  <label>Enable Autosave</label>
                  <input
                    type="checkbox"
                    checked={settings.autoSaveEnabled}
                    onChange={e => updateSettings({ autoSaveEnabled: e.target.checked })}
                  />
                </div>
                <div className="setting-row">
                  <label>Interval (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.autoSaveInterval}
                    onChange={e => updateSettings({ autoSaveInterval: Number(e.target.value) })}
                  />
                </div>
              </section>

							<button className="reset-btn" onClick={resetSettings} type="button">
                Reset to Defaults
              </button>
				</div>
			</div>
		</div>
  )
}
