"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormulaEvaluator = void 0;
class FormulaEvaluator {
    /**
     * Evaluates a formula expression based on a record's data.
     * @param formula e.g. "{hourlyRate} * {hoursWorked}"
     * @param recordData e.g. { hourlyRate: 50, hoursWorked: 10 }
     * @returns evaluated number or null
     */
    static evaluate(formula, recordData) {
        try {
            // 1. Substitute variables in the formula
            // Find all matches for {...}
            const variableRegex = /\{([a-zA-Z0-9_]+)\}/g;
            let expression = formula;
            let match;
            while ((match = variableRegex.exec(formula)) !== null) {
                const fieldName = match[1];
                const rawValue = recordData[fieldName];
                // Default unassigned or non-numeric variables to 0 to prevent evaluation errors
                const val = (rawValue !== undefined && rawValue !== null && !isNaN(Number(rawValue)))
                    ? Number(rawValue)
                    : 0;
                expression = expression.replace(match[0], val.toString());
            }
            // 2. Sanitize the mathematical expression to prevent injection code executions
            // Allowed characters: numbers, spaces, decimals, parenthesis, +, -, *, /, %, ?, :
            const sanitizedExpr = expression.replace(/[^0-9\s.+\-*/%?:()]/g, '');
            if (!sanitizedExpr.trim()) {
                return null;
            }
            // 3. Evaluate expression using standard Function constructor (isolated sandboxed math calculation)
            // eslint-disable-next-line no-new-func
            const result = new Function(`return (${sanitizedExpr});`)();
            return typeof result === 'number' && !isNaN(result) ? result : null;
        }
        catch (error) {
            console.error('Error evaluating formula:', formula, error);
            return null;
        }
    }
}
exports.FormulaEvaluator = FormulaEvaluator;
