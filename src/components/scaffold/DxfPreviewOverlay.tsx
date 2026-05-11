import { useMemo } from 'react'

import { useTool } from '../../contexts/ToolContext'
import { useScaffoldBaseSettings } from '../../contexts/ScaffoldBaseSettings'
import { buildScaffoldCenterlineModelFt } from '../../utils/dxf/scaffoldCenterlines'
import type { RinglockDiagonalInstance } from './RinglockDiagonals'

export function DxfPreviewOverlay({
	diagonals = [],
}: {
	diagonals?: RinglockDiagonalInstance[]
}) {
  const { scaffoldStacks, ledgerConnections } = useTool()
  const { baseSettings } = useScaffoldBaseSettings()

  const model = useMemo(() => {
    return buildScaffoldCenterlineModelFt({
      scaffoldStacks,
      ledgerConnections,
      baseSettings: {
        showWoodSill: baseSettings.showWoodSill,
        showBaseCollar: baseSettings.showBaseCollar,
      },
    })
  }, [scaffoldStacks, ledgerConnections, baseSettings.showWoodSill, baseSettings.showBaseCollar])

	const { standardLinePositions, ledgerLinePositions, jackLinePositions, diagonalLinePositions } = useMemo(() => {
		const build = (segs: typeof model.segmentsFt) => {
			const arr = new Float32Array(segs.length * 2 * 3)
			let i = 0
			for (const s of segs) {
				arr[i++] = s.start.x
				arr[i++] = s.start.y
				arr[i++] = s.start.z
				arr[i++] = s.end.x
				arr[i++] = s.end.y
				arr[i++] = s.end.z
			}
			return arr
		}

		const standards = model.segmentsFt.filter(s => s.layer === 'SCF_STANDARD')
		const ledgers = model.segmentsFt.filter(s => s.layer === 'SCF_LEDGER')
		const jacks = model.segmentsFt.filter(s => s.layer === 'SCF_JACK')
		const diagonalSegments = diagonals.map((diagonal) => ({
			start: diagonal.start,
			end: diagonal.end,
		}))
		return {
			standardLinePositions: build(standards),
			ledgerLinePositions: build(ledgers),
			jackLinePositions: build(jacks),
			diagonalLinePositions: build(diagonalSegments as typeof model.segmentsFt),
		}
	}, [diagonals, model.segmentsFt])

  const pointPositions = useMemo(() => {
    const arr = new Float32Array(model.pointsFt.length * 3)
    let i = 0
    for (const p of model.pointsFt) {
      arr[i++] = p.x
      arr[i++] = p.y
      arr[i++] = p.z
    }
    return arr
  }, [model.pointsFt])

  return (
    <group>
			{standardLinePositions.length > 0 && (
				<lineSegments renderOrder={999} raycast={() => null} frustumCulled={false}>
					<bufferGeometry>
						<bufferAttribute
							attach="attributes-position"
							array={standardLinePositions}
							itemSize={3}
							count={standardLinePositions.length / 3}
						/>
					</bufferGeometry>
					<lineBasicMaterial color="#00e5ff" transparent opacity={0.95} depthTest={false} />
				</lineSegments>
			)}

			{ledgerLinePositions.length > 0 && (
				<lineSegments renderOrder={999} raycast={() => null} frustumCulled={false}>
					<bufferGeometry>
						<bufferAttribute
							attach="attributes-position"
							array={ledgerLinePositions}
							itemSize={3}
							count={ledgerLinePositions.length / 3}
						/>
					</bufferGeometry>
					<lineBasicMaterial color="#34d399" transparent opacity={0.95} depthTest={false} />
				</lineSegments>
			)}

			{jackLinePositions.length > 0 && (
				<lineSegments renderOrder={999} raycast={() => null} frustumCulled={false}>
					<bufferGeometry>
						<bufferAttribute
							attach="attributes-position"
							array={jackLinePositions}
							itemSize={3}
							count={jackLinePositions.length / 3}
						/>
					</bufferGeometry>
					<lineBasicMaterial color="#f59e0b" transparent opacity={0.95} depthTest={false} />
				</lineSegments>
			)}

			{diagonalLinePositions.length > 0 && (
				<lineSegments renderOrder={999} raycast={() => null} frustumCulled={false}>
					<bufferGeometry>
						<bufferAttribute
							attach="attributes-position"
							array={diagonalLinePositions}
							itemSize={3}
							count={diagonalLinePositions.length / 3}
						/>
					</bufferGeometry>
					<lineBasicMaterial color="#cbd5e1" transparent opacity={0.95} depthTest={false} />
				</lineSegments>
			)}

      <points renderOrder={1000} raycast={() => null} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={pointPositions}
            itemSize={3}
            count={pointPositions.length / 3}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#ffffff"
          size={0.08}
          sizeAttenuation={false}
          transparent
          opacity={0.9}
          depthTest={false}
        />
      </points>
    </group>
  )
}
