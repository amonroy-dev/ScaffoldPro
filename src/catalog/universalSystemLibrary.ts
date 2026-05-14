export type UniversalSystemLibraryCategoryKey =
  | 'columns'
  | 'horizontals'
  | 'diagonals'
  | 'planks'
  | 'sidearms'
  | 'stairs'
  | 'crossBracing'

export type UniversalSystemLibraryEntry = {
  description: string
  weightLb: number
}

type UniversalSystemLibraryCategory = Record<string, UniversalSystemLibraryEntry>

/**
 * Extracted from `myLaunchpad/apps/legloads.html` (`BASE_LIBRARIES` + `DESCRIPTIONS`)
 * for the "Universal System Scaffold" library.
 */
export const UNIVERSAL_SYSTEM_SCAFFOLD_LIBRARY: {
  manufacturerName: string
  libraryName: string
  categories: Record<UniversalSystemLibraryCategoryKey, UniversalSystemLibraryCategory>
} = {
  manufacturerName: 'Universal Manufacturing',
  libraryName: 'Universal System Scaffold',
  categories: {
    columns: {
      US99: { description: `9'-9" Standard`, weightLb: 33.2 },
      US66: { description: `6'-6" Standard`, weightLb: 23.0 },
      US411: { description: `4'-11" Standard`, weightLb: 17.5 },
      US33: { description: `3'-3" Standard`, weightLb: 13.5 },
      US17: { description: `1'-7" Standard`, weightLb: 7.5 },
      US17T: { description: `1'-7" Topping-off Standard`, weightLb: 4.0 },
      UBC: { description: 'Base Collar', weightLb: 4.0 },
      USJ20: { description: 'Screw Jack', weightLb: 9.0 },
      UCBC: { description: 'Caster Base Collar', weightLb: 7.0 },
      USSJ20: { description: 'Swivel Screw Jack', weightLb: 12.0 },
      'F-8R': { description: `8" Caster`, weightLb: 13.5 },
      'P-12-R': { description: `12" Caster`, weightLb: 36.0 },
      UBCB: { description: 'Base Collar W/ Bushing', weightLb: 5.73 },
      USAUH8X8: { description: 'Adj Screw Jack w/ U-Head', weightLb: 22.0 },
      U12AL: { description: 'Adjustable Leg', weightLb: 8.5 },
      US12CA: { description: `12" Caster Adapter`, weightLb: 8.0 },
      US12CASJ: { description: `12" Caster Adapt w/ Screw J`, weightLb: 20.0 },
      'U-SAU6': { description: `6' Ladder`, weightLb: 17.5 },
      'U-SAU3': { description: `3' Ladder`, weightLb: 9.5 },
      'U-SAUB': { description: 'Ladder Bracket', weightLb: 3.0 },
      '79709': { description: 'CGA3556 Adj. Guard Gate', weightLb: 23.0 },
      CGA30: { description: `3'-0 Swing Gate`, weightLb: 23.0 },
      CGA3640: { description: `3'-6 Thru 4'-0 Swing Gate`, weightLb: 20.0 },
      '76019': { description: 'Rosette Clamp', weightLb: 3.5 },
      URC: { description: 'Rigid Clamp', weightLb: 3.2 },
      USC: { description: 'Swivel Clamp', weightLb: 3.5 },
      UGC: { description: 'Rigid Beam Clamp', weightLb: 3.0 },
      'UGC-S': { description: 'Swivel Beam Clamp', weightLb: 3.5 },
    },
    horizontals: {
      UH100: { description: `10'-0" Horizontal`, weightLb: 21.5 },
      UH80: { description: `8'-0" Horizontal`, weightLb: 17.8 },
      UH70: { description: `7'-0" Horizontal`, weightLb: 15.5 },
      UH60: { description: `6'-0" Horizontal`, weightLb: 15.0 },
      UH50: { description: `5'-0" Horizontal`, weightLb: 13.0 },
      UH40: { description: `4'-0" Horizontal`, weightLb: 11.0 },
      UH36: { description: `3'-6" Horizontal`, weightLb: 9.5 },
      UH30: { description: `3'-0" Horizontal`, weightLb: 8.5 },
      UH20: { description: `2'-0" Horizontal`, weightLb: 6.0 },
      UH10: { description: `1'-0" Horizontal`, weightLb: 3.9 },
      UHT100: { description: `10'-0" Horizontal Truss`, weightLb: 41.5 },
      UHT80: { description: `8'-0" Horizontal Truss`, weightLb: 36.8 },
      UHT70: { description: `7'-0" Horizontal Truss`, weightLb: 24.5 },
      UHT60: { description: `6'-0" Horizontal Truss`, weightLb: 19.0 },
      UHT50: { description: `5'-0" Horizontal Truss`, weightLb: 16.5 },
      USTA: { description: 'Truss Adapter', weightLb: 4.5 },
      UCCS: { description: 'Clamp on Column Support', weightLb: 3.5 },
      UHTCS: { description: 'Truss Column Saddle', weightLb: 7.0 },
      UT20: { description: `20'-0" Truss`, weightLb: 136.0 },
      UT18: { description: `18'-0" Truss`, weightLb: 137.0 },
      UT16: { description: `16'-0" Truss`, weightLb: 108.0 },
      UT14: { description: `14'-0" Truss`, weightLb: 109.0 },
      UT12: { description: `12'-0" Truss`, weightLb: 92.0 },
      UT10: { description: `10'-0" Truss`, weightLb: 68.0 },
      UT8: { description: `8'-0" Truss`, weightLb: 54.0 },
      UT7: { description: `7'-0" Truss`, weightLb: 45.0 },
      UT6: { description: `6'-0" Truss`, weightLb: 41.0 },
      'TS-2-20': { description: `20'-0" Endlok Tube`, weightLb: 38.0 },
      'TS-2-16': { description: `16'-0" Endlok Tube`, weightLb: 31.0 },
      'TS-2-13': { description: `13'-0" Endlok Tube`, weightLb: 25.0 },
      'TS-2-10': { description: `10'-0" Endlok Tube`, weightLb: 20.5 },
      'TS-2-8': { description: `8'-0" Endlok Tube`, weightLb: 17.0 },
      'TS-2-6': { description: `6'-0" Endlok Tube`, weightLb: 13.5 },
      'TS-2-4': { description: `4'-0" Endlok Tube`, weightLb: 9.5 },
      'WT-40': { description: `4'-0" Wall Tie`, weightLb: 8.0 },
    },
    diagonals: {
      UD100: { description: `10'-0" Diagonal`, weightLb: 25.5 },
      UD80: { description: `8'-0" Diagonal`, weightLb: 22.2 },
      UD70: { description: `7'-0" Diagonal`, weightLb: 21.0 },
      UD60: { description: `6'-0" Diagonal`, weightLb: 19.7 },
      UD50: { description: `5'-0" Diagonal`, weightLb: 19.0 },
      UD40: { description: `4'-0" Diagonal`, weightLb: 17.5 },
      UD36: { description: `3'-6" Diagonal`, weightLb: 17.0 },
      UD30: { description: `3'-0" Diagonal`, weightLb: 17.0 },
      UD20: { description: `2'-0" Diagonal`, weightLb: 17.0 },
    },
    planks: {
      EAP100: { description: `10'-0" Aluminum Plank`, weightLb: 41.0 },
      EAP70: { description: `7'-0" Aluminum Plank`, weightLb: 30.0 },
      'AP-100': { description: `10'-0" Aluminum w/ Ply`, weightLb: 43.0 },
      'AP-70': { description: `7'-0" Aluminum w/ Ply`, weightLb: 27.0 },
      USP100DG: { description: `10'-0" Steel Plank`, weightLb: 43.0 },
      USP80DG: { description: `8'-0" Steel Plank`, weightLb: 37.0 },
      USP70DG: { description: `7'-0" Steel Plank`, weightLb: 29.0 },
      USP60DG: { description: `6'-0" Steel Plank`, weightLb: 26.24 },
      USP50DG: { description: `5'-0" Steel Plank`, weightLb: 21.5 },
      USP40DG: { description: `4'-0" Steel Plank`, weightLb: 18.21 },
      USP36DG: { description: `3'-6" Steel Plank`, weightLb: 15.0 },
      USP30DG: { description: `3'-0" Steel Plank`, weightLb: 14.0 },
      USP20DG: { description: `2'-0" Steel Plank`, weightLb: 9.5 },
      USP100ADG: { description: `10'-0" "A" Style Steel Plank`, weightLb: 45.0 },
      'USP100-6ADG': { description: `10'-0" "A" Style (6" Wide)`, weightLb: 41.5 },
      USP80ADG: { description: `8'-0" "A" Style Steel Plank`, weightLb: 35.01 },
      'USP80-6ADG': { description: `8'-0" "A" Style (6" Wide)`, weightLb: 28.0 },
      USP70ADG: { description: `7'-0" "A" Style Steel Plank`, weightLb: 31.0 },
      'USP70-6ADG': { description: `7'-0" "A" Style (6" Wide)`, weightLb: 24.0 },
      USP60ADG: { description: `6'-0" "A" Style Steel Plank`, weightLb: 28.0 },
      'USP60-6ADG': { description: `6'-0" "A" Style (6" Wide)`, weightLb: 20.0 },
      USP50ADG: { description: `5'-0" "A" Style Steel Plank`, weightLb: 23.0 },
      'USP50-6ADG': { description: `5'-0" "A" Style (6" Wide)`, weightLb: 19.36 },
      USP40ADG: { description: `4'-0" "A" Style Steel Plank`, weightLb: 18.5 },
      'USP40-6ADG': { description: `4'-0" "A" Style (6" Wide)`, weightLb: 17.2 },
      USP36ADG: { description: `3'-6" "A" Style Steel Plank`, weightLb: 17.0 },
      'USP36-6ADG': { description: `3'-6" "A" Style (6" Wide)`, weightLb: 14.0 },
      USP30ADG: { description: `3'-0" "A" Style Steel Plank`, weightLb: 15.0 },
      'USP30-6ADG': { description: `3'-0" "A" Style (6" Wide)`, weightLb: 10.48 },
      USP20ADG: { description: `2'-0" "A" Style Steel Plank`, weightLb: 11.5 },
      'USP20-6ADG': { description: `2'-0" "A" Style (6" Wide)`, weightLb: 7.78 },
    },
    sidearms: {
      USB36: { description: `3'-6" Side Bracket`, weightLb: 25.5 },
      USB30: { description: `3'-0" Side Bracket`, weightLb: 22.5 },
      USB20: { description: `2'-0" Side Bracket`, weightLb: 16.5 },
      UBB18: { description: '2 Board Bracket', weightLb: 8.75 },
      UBB010: { description: '1 Board Bracket', weightLb: 3.0 },
      UBB010CO: { description: '1 Board Clamp on Bracket', weightLb: 3.5 },
    },
    stairs: {
      USSL70: { description: `7' Stair Stringer Left`, weightLb: 51.5 },
      USSR70: { description: `7' Stair Stringer Right`, weightLb: 51.5 },
      USTL: { description: 'Starter Stair Stringer Left', weightLb: 26.0 },
      USTR: { description: 'Starter Stair Stringer Right', weightLb: 26.0 },
      U4HR: { description: '4-hour rail', weightLb: 23.0 },
      UST26: { description: `2'-6" Stair Tread`, weightLb: 12.0 },
      USD36: { description: `3'-6" Starter Stair Diagonal`, weightLb: 12.5 },
      'SU-66AL': { description: 'Aluminum Stair', weightLb: 56.0 },
      'SU-66ALO': { description: 'Alum Stair Outside GR', weightLb: 29.5 },
      'SU-66ALI': { description: 'Alum Stair Inside GR', weightLb: 15.5 },
      USHR: { description: 'Stair Handrail', weightLb: 24.58 },
      U6SHR: { description: '6 Step Stair Handrail', weightLb: 28.0 },
      U4SHR: { description: '4 Step Stair Handrail', weightLb: 22.75 },
      UST30: { description: `3'-0" Stair Tread`, weightLb: 14.0 },
    },
    crossBracing: {
      UPB3036: { description: `3' X 3'-6" Plan Bracing`, weightLb: 14.0 },
      UPB3636: { description: `3'-6" X 3'-6" Plan Bracing`, weightLb: 14.0 },
      UPB3640: { description: `3'-6" X 4' Plan Bracing`, weightLb: 14.0 },
      UPB3650: { description: `3'-6" X 5' Plan Bracing`, weightLb: 15.0 },
      UPB3660: { description: `3'-6" X 6' Plan Bracing`, weightLb: 18.5 },
      UPB3670: { description: `3'-6" X 7' Plan Bracing`, weightLb: 19.0 },
      UPB3680: { description: `3'-6" X 8' Plan Bracing`, weightLb: 20.8 },
      UPB4050: { description: `4' X 5' Plan Bracing`, weightLb: 15.0 },
      UPB4070: { description: `4' X 7' Plan Bracing`, weightLb: 19.8 },
      UPB40100: { description: `4' X 10' Plan Bracing`, weightLb: 24.5 },
      UPB5050: { description: `5' X 5' Plan Bracing`, weightLb: 17.8 },
      UPB5060: { description: `5' X 5' Plan Bracing`, weightLb: 19.2 },
      UPB5070: { description: `5' X 7' Plan Bracing`, weightLb: 20.5 },
      UPB5080: { description: `5' X 8' Plan Bracing`, weightLb: 22.3 },
      UPB50100: { description: `5' X 10' Plan Bracing`, weightLb: 25.3 },
      UPB6060: { description: `6' X 6' Plan Bracing`, weightLb: 26.29 },
      UPB6070: { description: `6' X 7' Plan Bracing`, weightLb: 22.3 },
      UPB6080: { description: `6' X 8' Plan Bracing`, weightLb: 21.0 },
      UPB7070: { description: `7' X 7' Plan Bracing`, weightLb: 23.0 },
      UPB7080: { description: `7' X 8' Plan Bracing`, weightLb: 24.0 },
      UPB70100: { description: `7' X 10' Plan Bracing`, weightLb: 27.3 },
      UPB8080: { description: `8 X 8' Plan Bracing`, weightLb: 22.5 },
    },
  },
}

export function getUniversalSystemLibraryEntry(
  category: UniversalSystemLibraryCategoryKey,
  partNumber: string,
) {
  return UNIVERSAL_SYSTEM_SCAFFOLD_LIBRARY.categories[category][partNumber]
}
