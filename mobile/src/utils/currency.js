/**
 * Utilidades para formateo y parseo monetario (Pesos Colombianos - COP).
 * Garantiza separación de miles con punto (.) en tiempo real y extracción
 * de números puros para cálculos matemáticos locales y payloads a FastAPI.
 */

/**
 * Convierte cualquier entrada de usuario en una cadena con formato de miles colombiano.
 * Ej: "15000" -> "15.000", "1500000" -> "1.500.000", "" -> ""
 *
 * @param {string|number} val - Entrada del usuario
 * @returns {string} - Cadena formateada con puntos de miles
 */
export const formatCurrencyInput = (val) => {
  if (val === null || val === undefined) return '';
  const rawDigits = String(val).replace(/\D/g, '');
  if (!rawDigits) return '';
  // Elimina ceros no significativos a la izquierda si hay más dígitos (ej. "015" -> "15")
  const trimmedDigits = rawDigits.replace(/^0+(?=\d)/, '');
  return trimmedDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

/**
 * Extrae el valor numérico entero limpio, inmune al bug de parseFloat("15.000") === 15.
 * Ej: "15.000" -> 15000, "$ 15.000" -> 15000, 15000 -> 15000
 *
 * @param {string|number} val - Cadena o número a limpiar
 * @returns {number} - Número entero puro en JavaScript
 */
export const parseCurrencyInput = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
  const rawDigits = String(val).replace(/\D/g, '');
  return rawDigits ? parseInt(rawDigits, 10) : 0;
};

/**
 * Retorna la cadena de dígitos puros sin puntos ni símbolos.
 * Ej: "15.000" -> "15000", "" -> "0"
 *
 * @param {string|number} val - Entrada
 * @returns {string} - Cadena de solo dígitos
 */
export const cleanNumericString = (val) => {
  if (val === null || val === undefined || val === '') return '0';
  const rawDigits = String(val).replace(/\D/g, '');
  return rawDigits || '0';
};
