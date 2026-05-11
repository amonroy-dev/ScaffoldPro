$filePath = Join-Path $PWD 'src/components/scaffold/PlaceBlockTool.tsx'
$lines = [System.IO.File]::ReadAllLines($filePath, [System.Text.Encoding]::UTF8)
Write-Host "Total lines: $($lines.Length)"
Write-Host "Line 654 (index 653): $($lines[653])"
Write-Host "Line 781 (index 780): $($lines[780])"
Write-Host "Line 782 (index 781): $($lines[781])"

# Keep lines 1-653 (index 0-652), replace 654-781 (index 653-780), keep 782+ (index 781+)
$before = $lines[0..652]
$after = $lines[781..($lines.Length-1)]

$replacement = @(
	"`tconst handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {"
	"`t`tif (!canPlace || !isVisibleRef.current) return"
	"`t`tevent.stopPropagation()"
	"`t`tevent.nativeEvent.stopImmediatePropagation?.()"
	"`t`tconst cx = ghostPositionRef.current.x"
	"`t`tconst cy = ghostPositionRef.current.y"
	"`t`tplaceBlockAtRef.current?.(cx, cy)"
	"`t`t// Start drag: record the placed center so useFrame can auto-place adjacent blocks."
	"`t`tisDraggingRef.current = true"
	"`t`tlastDragCenterRef.current = { x: cx, y: cy }"
	"`t}, [canPlace])"
	""
	"`t// Stop drag on pointer up (window level)."
	"`tuseEffect(() => {"
	"`t`tif (!canPlace) return"
	"`t`tconst onPointerUp = () => {"
	"`t`t`tisDraggingRef.current = false"
	"`t`t`tlastDragCenterRef.current = null"
	"`t`t}"
	"`t`twindow.addEventListener('pointerup', onPointerUp)"
	"`t`treturn () => window.removeEventListener('pointerup', onPointerUp)"
	"`t}, [canPlace])"
)

$allLines = $before + $replacement + $after
$result = $allLines -join "`r`n"
[System.IO.File]::WriteAllText($filePath, $result, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Done. New total lines: $($allLines.Length)"

