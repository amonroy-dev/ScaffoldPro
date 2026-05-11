export const INCHES_PER_FOOT = 12

export function inchesToFeet(inches: number): number {
  return inches / INCHES_PER_FOOT
}

export function feetInchesToFeet(feet: number, inches: number): number {
  return feet + inchesToFeet(inches)
}
