/**
 * Unit conversion utilities for ScaffoldPro
 * Primary unit: feet (imperial)
 * Secondary: meters (metric)
 */

// Conversion constants
const FEET_TO_METERS = 0.3048
const METERS_TO_FEET = 1 / FEET_TO_METERS
const FEET_TO_INCHES = 12
const METERS_TO_CM = 100
const METERS_TO_MM = 1000
const LBS_TO_KG = 0.453592
const KG_TO_LBS = 1 / LBS_TO_KG

// Length conversions
export const feetToMeters = (ft: number): number => ft * FEET_TO_METERS
export const metersToFeet = (m: number): number => m * METERS_TO_FEET
export const feetToInches = (ft: number): number => ft * FEET_TO_INCHES
export const inchesToFeet = (inches: number): number => inches / FEET_TO_INCHES
export const metersToCm = (m: number): number => m * METERS_TO_CM
export const metersToMm = (m: number): number => m * METERS_TO_MM

// Area conversions (squared)
export const sqFeetToSqMeters = (sqFt: number): number => sqFt * (FEET_TO_METERS ** 2)
export const sqMetersToSqFeet = (sqM: number): number => sqM * (METERS_TO_FEET ** 2)

// Volume conversions (cubed)
export const cuFeetToCuMeters = (cuFt: number): number => cuFt * (FEET_TO_METERS ** 3)
export const cuMetersToCuFeet = (cuM: number): number => cuM * (METERS_TO_FEET ** 3)

// Weight conversions
export const lbsToKg = (lbs: number): number => lbs * LBS_TO_KG
export const kgToLbs = (kg: number): number => kg * KG_TO_LBS

// Generic converter based on unit system
export type UnitSystem = 'imperial' | 'metric'

export function convertLength(value: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return value
  return from === 'imperial' ? feetToMeters(value) : metersToFeet(value)
}

export function formatLength(value: number, system: UnitSystem, precision = 2): string {
  const unit = system === 'imperial' ? 'ft' : 'm'
  return `${value.toFixed(precision)} ${unit}`
}

export function formatArea(value: number, system: UnitSystem, precision = 2): string {
  const unit = system === 'imperial' ? 'ft²' : 'm²'
  return `${value.toFixed(precision)} ${unit}`
}

export function formatVolume(value: number, system: UnitSystem, precision = 2): string {
  const unit = system === 'imperial' ? 'ft³' : 'm³'
  return `${value.toFixed(precision)} ${unit}`
}

export function formatWeight(value: number, system: UnitSystem, precision = 2): string {
  const unit = system === 'imperial' ? 'lb' : 'kg'
  return `${value.toFixed(precision)} ${unit}`
}

