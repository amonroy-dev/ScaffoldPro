import { readFileSync, writeFileSync } from 'fs';

const filePath = 'src/components/scaffold/PlaceBlockTool.tsx';
const content = readFileSync(filePath, 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);
console.log('Line 654:', JSON.stringify(lines[653].slice(0, 60)));
console.log('Line 781:', JSON.stringify(lines[780].slice(0, 60)));

// Keep lines 1-653, replace 654-781, keep 782+
const before = lines.slice(0, 653);
const after = lines.slice(781);

const replacement = [
	'\tconst handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {',
	'\t\tif (!canPlace || !isVisibleRef.current) return',
	'\t\tevent.stopPropagation()',
	'\t\tevent.nativeEvent.stopImmediatePropagation?.()',
	'\t\tconst cx = ghostPositionRef.current.x',
	'\t\tconst cy = ghostPositionRef.current.y',
	'\t\tplaceBlockAtRef.current?.(cx, cy)',
	'\t\t// Start drag: record the placed center so useFrame can auto-place adjacent blocks.',
	'\t\tisDraggingRef.current = true',
	'\t\tlastDragCenterRef.current = { x: cx, y: cy }',
	'\t}, [canPlace])',
	'',
	'\t// Stop drag on pointer up (window level).',
	'\tuseEffect(() => {',
	'\t\tif (!canPlace) return',
	'\t\tconst onPointerUp = () => {',
	'\t\t\tisDraggingRef.current = false',
	'\t\t\tlastDragCenterRef.current = null',
	'\t\t}',
	'\t\twindow.addEventListener(\'pointerup\', onPointerUp)',
	'\t\treturn () => window.removeEventListener(\'pointerup\', onPointerUp)',
	'\t}, [canPlace])',
];

const allLines = [...before, ...replacement, ...after];
writeFileSync(filePath, allLines.join('\n'), 'utf8');
console.log('Done. New total lines:', allLines.length);
console.log('New line 654:', JSON.stringify(allLines[653].slice(0, 60)));

