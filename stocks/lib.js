// 
// 
//  api.js
// 
// 

// 定义一个数组，包含额外的数字格式，用于处理非常大的数字
const extraFormats = [1e15, 1e18, 1e21, 1e24, 1e27, 1e30];
// 定义一个数组，包含额外的数字符号，用于表示非常大的数字
const extraNotations = ["q", "Q", "s", "S", "o", "n"];
// 定义小数位数，用于格式化数字
const decimalPlaces = 3;

/**
 * 使用nFormat格式化普通数值
 * @param {object} ns - 包含nFormat函数的对象
 * @param {number} number - 要格式化的数字
 * @returns {string} - 格式化后的字符串
 */
// 对普通数值使用nFormat进行格式化
export function format(ns, number) {
    // 如果数字的绝对值小于1e-6，则将其视为0
    if (Math.abs(number) < 1e-6) {
        number = 0;
    }

    // 使用ns.nFormat函数格式化数字，保留三位小数并添加数字符号
    const answer = ns.nFormat(number, '$0.000a');;

    // 如果格式化结果为NaN，则返回原始数字的字符串形式
    if (answer === "NaN") {
        return `${number}`;
    }

    // 返回格式化后的结果
    return answer;
}

/**
 * numeral.js无法正确格式化非常大或非常小的数字
 * 因此，我们为超过 't' 的值提供自己的格式化函数
 * @param {object} ns - 包含nFormat函数的对象
 * @param {number} number - 要格式化的数字
 * @returns {string} - 格式化后的字符串
 */
// numeral.js无法正确格式化极大或极小的数字
// 因此，我们为超过 't' 的数值提供自定义的格式化函数
export function formatReallyBigNumber(ns, number) {
    // 如果数字为无穷大，则返回无穷大符号
    if (number === Infinity) return "∞";

    // 遍历extraFormats数组，找到适合当前数字的格式
    for (let i = 0; i < extraFormats.length; i++) {
        if (extraFormats[i] < number && number <= extraFormats[i] * 1000) {
            // 使用format函数格式化数字，并添加相应的符号
            return format(ns, number / extraFormats[i], "0." + "0".repeat(decimalPlaces)) + extraNotations[i];
        }
    }

    // 如果数字的绝对值小于1000，则直接使用format函数格式化
    if (Math.abs(number) < 1000) {
        return format(ns, number, "0." + "0".repeat(decimalPlaces));
    }

    // 使用format函数格式化数字，并添加数字符号
    const str = format(ns, number, "0." + "0".repeat(decimalPlaces) + "a");

    // 如果格式化结果为NaN，则使用科学计数法格式化
    if (str === "NaN") return format(ns, number, "0." + " ".repeat(decimalPlaces) + "e+0");

    // 返回格式化后的结果
    return str;
}
