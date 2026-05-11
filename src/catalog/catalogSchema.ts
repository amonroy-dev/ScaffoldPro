import * as z from 'zod'

/**
 * Catalog core schemas (runtime validation) + inferred TS types.
 *
 * Goal: a strict, manufacturer-aware hierarchy:
 *   Manufacturer -> Category -> Part
 *
 * Notes:
 * - We keep IDs stable and globally unique: `${mfrCode}_${catCode}_${partNumber}`.
 * - Tube dimensions are stored per-part (even if currently identical) so you can
 *   later introduce exceptions without changing the data model.
 */

export const CatalogManufacturerIdSchema = z.enum([
  'universal',
  'layher',
  'brandsafway',
  'direct',
])
export type CatalogManufacturerId = z.infer<typeof CatalogManufacturerIdSchema>

export const CatalogCategoryKeySchema = z.enum(['standards', 'ledgers', 'braces', 'trusses', 'sideBrackets', 'planks', 'liveLoads'])
export type CatalogCategoryKey = z.infer<typeof CatalogCategoryKeySchema>

/** Short code used in IDs (e.g. UMC_STD_US99). */
export const CATEGORY_CODE: Record<CatalogCategoryKey, string> = {
  standards: 'STD',
  ledgers: 'LED',
  braces: 'BRC',
  trusses: 'TRS',
  sideBrackets: 'SBR',
  planks: 'PLK',
  liveLoads: 'LLD',
} as const

/**
 * Base ID pattern: 3 uppercase segments separated by underscores.
 * The final part-number segment may include hyphens so manufacturer part numbers
 * like USP20ADG-6 can be preserved in stable IDs.
 * We enforce deeper correctness (mfr+category alignment + uniqueness) in superRefine.
 */
const PartIdSchema = z
  .string()
  .min(5)
  .regex(/^[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9-]+$/, 'Part id must look like CODE_CAT_PART')

export const CatalogPartSchema = z
  .object({
    id: PartIdSchema,
    partNumber: z.string().min(1),
    displayName: z.string().min(1).optional(),
    sourceWeightLb: z.number().positive().optional(),
    tubeODIn: z.number().positive().optional(),
    tubeWallIn: z.number().positive().optional(),
    plankWidthIn: z.number().positive().optional(),
    mouthpieceInsetIn: z.number().positive().optional(),
    finish: z.string().min(1).optional(),
    /** Placeholder; user will provide later. */
    description: z.string().min(1).optional(),
    /** Placeholder; user will provide later. */
    weightLb: z.number().positive().optional(),
  })
  .strict()
export type CatalogPart = z.infer<typeof CatalogPartSchema>

export const CatalogCategorySchema = z
  .object({
    key: CatalogCategoryKeySchema,
    name: z.string().min(1),
    parts: z.array(CatalogPartSchema),
  })
  .strict()
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>

export const CatalogManufacturerSchema = z
  .object({
    id: CatalogManufacturerIdSchema,
    name: z.string().min(1),
    /** Short code used in part IDs, e.g. UMC. */
    code: z.string().min(2).max(8).regex(/^[A-Z0-9]+$/),
    categories: z
      .object({
        standards: CatalogCategorySchema,
        ledgers: CatalogCategorySchema,
        braces: CatalogCategorySchema,
        trusses: CatalogCategorySchema,
        sideBrackets: CatalogCategorySchema,
        planks: CatalogCategorySchema,
        liveLoads: CatalogCategorySchema,
      })
      .strict(),
  })
  .strict()
export type CatalogManufacturer = z.infer<typeof CatalogManufacturerSchema>

export const CatalogSchema = z
  .object({
    manufacturers: z.array(CatalogManufacturerSchema).min(1),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    // 1) Manufacturer IDs must be unique.
    const seenMfr = new Set<string>()
    for (const m of catalog.manufacturers) {
      if (seenMfr.has(m.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate manufacturer id: ${m.id}`,
        })
      }
      seenMfr.add(m.id)
    }

    // 2) Part IDs must be globally unique.
    const seenPartIds = new Set<string>()

    // 3) Part ID format must align with manufacturer code + category code.
    for (const m of catalog.manufacturers) {
      const categories = m.categories
      ;(Object.keys(categories) as CatalogCategoryKey[]).forEach((key) => {
        const cat = categories[key]
        if (cat.key !== key) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Category key mismatch for ${m.id}.${key}: category.key is '${cat.key}'`,
          })
        }

        const catCode = CATEGORY_CODE[key]
        for (const p of cat.parts) {
          if (seenPartIds.has(p.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate part id: ${p.id}`,
            })
          }
          seenPartIds.add(p.id)

          const expectedPrefix = `${m.code}_${catCode}_`
          if (!p.id.startsWith(expectedPrefix)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Part id '${p.id}' must start with '${expectedPrefix}'`,
            })
          }
        }
      })
    }
  })

export type Catalog = z.infer<typeof CatalogSchema>

export function makePartId(params: {
  manufacturerCode: string
  categoryKey: CatalogCategoryKey
  partNumber: string
}): string {
  return `${params.manufacturerCode}_${CATEGORY_CODE[params.categoryKey]}_${params.partNumber}`
}

/** Validates and returns a typed catalog. Throws if invalid. */
export function validateCatalog(catalog: unknown): Catalog {
  return CatalogSchema.parse(catalog)
}

/**
 * JSON Schema export (for future: persistence, API validation, interchange).
 * Zod v4 provides first-party JSON Schema conversion.
 */
export const CatalogJsonSchema = z.toJSONSchema(CatalogSchema)
