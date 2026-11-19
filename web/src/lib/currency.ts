/**
 * Utilidades para formateo y parseo monetario (Pesos Colombianos - COP) en Web.
 * Garantiza separación de miles con punto (.) en tiempo real y extracción
 * de números puros para cálculos matemáticos locales y payloads hacia FastAPI.
 */

/**
 * Convierte cualquier entrada de usuario en una cadena con formato de miles colombiano.
 * Ej: "15000" -> "15.000", "1500000" -> "1.500.000", "" -> "", 0 -> ""
 *
 * Si el valor es 0, null, undefined o vacío, retorna "" para que los inputs
 * con placeholder="0" permitan escribir fluidamente sin dejar ceros atrapados
 * a la izquierda.
 *
 * @param val - Entrada del usuario (string, number, null o undefined)
 * @returns Cadena formateada con puntos de miles o vacía
 */
export const formatCurrencyInput = (val: string | number | null | undefined): string => {
  if (val === null || val === undefined || val === '' || val === 0 || val === '0') return '';
  const rawDigits = String(val).replace(/\D/g, '');
  if (!rawDigits) return '';
  // Elimina ceros no significativos a la izquierda si hay más dígitos (ej. "015" -> "15")
  const trimmedDigits = rawDigits.replace(/^0+(?=\d)/, '');
  if (!trimmedDigits || trimmedDigits === '0') return '';
  return trimmedDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

/**
 * Extrae el valor numérico entero limpio, inmune al bug de parseFloat("15.000") === 15.
 * Ej: "15.000" -> 15000, "$ 15.000" -> 15000, 15000 -> 15000, "" -> 0
 *
 * @param val - Cadena o número a limpiar
 * @returns Número entero puro en JavaScript
 */
export const parseCurrencyInput = (val: string | number | null | undefined): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
  const rawDigits = String(val).replace(/\D/g, '');
  return rawDigits ? parseInt(rawDigits, 10) : 0;
};

/**
 * Retorna la cadena de dígitos puros sin puntos ni símbolos.
 * Ej: "15.000" -> "15000", "" -> "0"
 *
 * @param val - Entrada del usuario
 * @returns Cadena de solo dígitos
 */
export const cleanNumericString = (val: string | number | null | undefined): string => {
  if (val === null || val === undefined || val === '') return '0';
  const rawDigits = String(val).replace(/\D/g, '');
  return rawDigits || '0';
};
