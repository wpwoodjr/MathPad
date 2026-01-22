/**
 * MathPad Storage - localStorage persistence and import/export
 */

const STORAGE_KEY = 'mathpad_data';
const STORAGE_VERSION = 2;

/**
 * Default data structure
 */
function createDefaultData() {
    return {
        version: STORAGE_VERSION,
        records: [
            {
                id: generateId(),
                title: 'Example: TVM',
                text: `"Time Value of Money calculation"

"Monthly interest rate from annual"
mint = yint% / 12

"Payment calculation"
pmt$ = -(pv$ + fv$ / (1 + mint)**n) * mint / (1 - (1 + mint)**-n)

"Variables (example: compute monthly payment for loan of $100,000 for 30 years at 7.5%)"
pmt$: "monthly payment"
pv$: $100,000.00 "present value"
fv$: $0.00 "future value"
yint%: 7.5% "annual interest rate"
n: 360 "number of payments (30 years)"`,
                category: 'Finance',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float'
            },
            {
                id: generateId(),
                title: 'Example: Quadratic',
                text: `"Quadratic equation solver"
"ax^2 + bx + c = 0"

disc = b**2 - 4*a*c
x1 = (-b + sqrt(disc)) / (2*a)
x2 = (-b - sqrt(disc)) / (2*a)

a: 1
b: -5
c: 6
disc->
x1->
x2->`,
                category: 'Math',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float'
            },
            {
                id: generateId(),
                title: 'Constants',
                text: `"Physical and mathematical constants"
pi: 3.14159265358979
e: 2.71828182845905
c: 299792458 "speed of light m/s"
G: 6.67430e-11 "gravitational constant"
h: 6.62607015e-34 "Planck constant"
kB: 1.380649e-23 "Boltzmann constant"
NA: 6.02214076e23 "Avogadro number"
golden: 1.61803398874989 "golden ratio"`,
                category: 'Reference',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float'
            },
            {
                id: generateId(),
                title: 'Functions',
                text: `"User-defined functions"
"Compound interest"
compound(p;r;n;t) = p * (1 + r/n)**(n*t)

"Celsius to Fahrenheit"
ctof(c) = c * 9/5 + 32

"Fahrenheit to Celsius"
ftoc(f) = (f - 32) * 5/9

"Hypotenuse"
hypot(a;b) = sqrt(a**2 + b**2)

"Quadratic discriminant"
disc(a;b;c) = b**2 - 4*a*c`,
                category: 'Reference',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float'
            }
        ],
        categories: ['Unfiled', 'Finance', 'Math', 'Science', 'Reference', 'Personal'],
        settings: {
            degreesMode: false
        }
    };
}

/**
 * Generate a unique ID
 */
function generateId() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Load data from localStorage
 */
function loadData() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            // Migrate data if needed
            if (!data.version || data.version < STORAGE_VERSION) {
                return migrateData(data);
            }
            return data;
        }
    } catch (e) {
        console.error('Error loading data from localStorage:', e);
    }

    return createDefaultData();
}

/**
 * Save data to localStorage
 */
function saveData(data) {
    try {
        data.version = STORAGE_VERSION;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        console.error('Error saving data to localStorage:', e);
        if (e.name === 'QuotaExceededError') {
            alert('Storage quota exceeded. Please export and delete some records.');
        }
        return false;
    }
}

/**
 * Migrate old data format to new
 */
function migrateData(data) {
    // Migration from version 1 to version 2
    if (!data.version || data.version < 2) {
        for (const record of data.records || []) {
            // Convert places: 14 (old default) to places: 4 (new default)
            if (record.places === 14) {
                record.places = 4;
            }
            // Remove dead secret field
            delete record.secret;
            // Add missing format and groupDigits fields
            if (record.format === undefined) {
                record.format = 'float';
            }
            if (record.groupDigits === undefined) {
                record.groupDigits = false;
            }
        }
    }

    data.version = STORAGE_VERSION;
    return data;
}

/**
 * Debounced save function
 */
let saveTimeout = null;
function debouncedSave(data, delay = 500) {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        saveData(data);
        saveTimeout = null;
    }, delay);
}

/**
 * Export data to MpExport text format
 * Compatible with original MathPad export format
 */
function exportToText(data) {
    const SEPARATOR = '~~~~~~~~~~~~~~~~~~~~~~~~~~~';
    const lines = [];

    for (const record of data.records) {
        // Record metadata
        lines.push(`Category = "${record.category || 'Unfiled'}"; Secret = ${record.secret ? 1 : 0}`);
        lines.push(`Places = ${record.places ?? 4}; StripZeros = ${record.stripZeros ? 1 : 0}`);
        lines.push(`Format = "${record.format || 'float'}"; GroupDigits = ${record.groupDigits ? 1 : 0}`);
        if (record.status) {
            // Escape quotes in status message
            const escapedStatus = record.status.replace(/"/g, '\\"');
            lines.push(`Status = "${escapedStatus}"; StatusIsError = ${record.statusIsError ? 1 : 0}`);
        }

        // Record title as first line comment
        if (record.title) {
            // Check if title is already in the text as the first comment
            const firstLine = record.text.split('\n')[0].trim();
            if (!firstLine.startsWith('"') || !firstLine.includes(record.title)) {
                lines.push(`"${record.title}"`);
            }
        }

        // Record content
        lines.push(record.text);

        // Separator
        lines.push(SEPARATOR);
    }

    return lines.join('\n');
}

/**
 * Import data from MpExport text format
 */
function importFromText(text, existingData = null) {
    const SEPARATOR = '~~~~~~~~~~~~~~~~~~~~~~~~~~~';
    const records = [];
    const chunks = text.split(SEPARATOR);

    for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;

        const lines = trimmed.split('\n');
        let category = 'Unfiled';
        let secret = false;
        let places = 4;
        let stripZeros = true;
        let format = 'float';
        let groupDigits = false;
        let status = '';
        let statusIsError = false;
        let contentStart = 0;

        // Parse metadata lines
        for (let i = 0; i < Math.min(4, lines.length); i++) {
            const line = lines[i].trim();

            // Category and Secret line
            const catMatch = line.match(/Category\s*=\s*"([^"]*)"\s*;\s*Secret\s*=\s*(\d+)/i);
            if (catMatch) {
                category = catMatch[1];
                secret = catMatch[2] === '1';
                contentStart = i + 1;
                continue;
            }

            // Places and StripZeros line
            const placesMatch = line.match(/Places\s*=\s*(\d+)\s*;\s*StripZeros\s*=\s*(\d+)/i);
            if (placesMatch) {
                places = parseInt(placesMatch[1]);
                stripZeros = placesMatch[2] === '1';
                contentStart = i + 1;
                continue;
            }

            // Format and GroupDigits line (new in v2)
            const formatMatch = line.match(/Format\s*=\s*"([^"]*)"\s*;\s*GroupDigits\s*=\s*(\d+)/i);
            if (formatMatch) {
                format = formatMatch[1];
                groupDigits = formatMatch[2] === '1';
                contentStart = i + 1;
                continue;
            }

            // Status line (new in v3)
            const statusMatch = line.match(/Status\s*=\s*"(.*)"\s*;\s*StatusIsError\s*=\s*(\d+)/i);
            if (statusMatch) {
                // Unescape quotes in status message
                status = statusMatch[1].replace(/\\"/g, '"');
                statusIsError = statusMatch[2] === '1';
                contentStart = i + 1;
                continue;
            }
        }

        // Rest is content
        const contentLines = lines.slice(contentStart);
        const content = contentLines.join('\n').trim();

        if (!content) continue;

        // Extract title from first comment line if present
        let title = '';
        const firstLine = contentLines[0]?.trim() || '';
        const titleMatch = firstLine.match(/^"([^"]+)"$/);
        if (titleMatch) {
            title = titleMatch[1];
        } else {
            // Use first few words of first non-empty, non-comment line
            for (const line of contentLines) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('"')) {
                    title = trimmedLine.substring(0, 30);
                    if (trimmedLine.length > 30) title += '...';
                    break;
                }
            }
            if (!title && contentLines.length > 0) {
                title = 'Untitled';
            }
        }

        records.push({
            id: generateId(),
            title: title,
            text: content,
            category: category,
            places: places,
            stripZeros: stripZeros,
            groupDigits: groupDigits,
            format: format,
            status: status,
            statusIsError: statusIsError
        });
    }

    // Merge with existing data or create new
    if (existingData) {
        // Add new categories
        const existingCategories = new Set(existingData.categories);
        for (const record of records) {
            if (record.category && !existingCategories.has(record.category)) {
                existingData.categories.push(record.category);
                existingCategories.add(record.category);
            }
        }

        // Add records
        existingData.records = [...existingData.records, ...records];
        return existingData;
    }

    // Create new data structure
    const categories = new Set(['Unfiled']);
    for (const record of records) {
        if (record.category) {
            categories.add(record.category);
        }
    }

    return {
        version: STORAGE_VERSION,
        records: records,
        categories: [...categories],
        settings: {
            degreesMode: false
        }
    };
}

/**
 * Download text as a file
 */
function downloadTextFile(text, filename = 'mathpad_export.txt') {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Read a file and return its text content
 */
function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

/**
 * Create a new record
 */
function createRecord(title = 'New Record', category = 'Unfiled') {
    return {
        id: generateId(),
        title: title,
        text: `"${title}"\n\n`,
        category: category,
        places: 4,
        stripZeros: true,
        groupDigits: false,
        format: 'float',
        status: '',
        statusIsError: false
    };
}

/**
 * Delete a record by ID
 */
function deleteRecord(data, recordId) {
    data.records = data.records.filter(r => r.id !== recordId);
    return data;
}

/**
 * Find a record by ID
 */
function findRecord(data, recordId) {
    return data.records.find(r => r.id === recordId);
}

/**
 * Update a record
 */
function updateRecord(data, recordId, updates) {
    const record = findRecord(data, recordId);
    if (record) {
        Object.assign(record, updates);
    }
    return data;
}

/**
 * Add a new category
 */
function addCategory(data, categoryName) {
    if (!data.categories.includes(categoryName)) {
        data.categories.push(categoryName);
    }
    return data;
}

/**
 * Delete a category (moves records to Unfiled)
 */
function deleteCategory(data, categoryName) {
    if (categoryName === 'Unfiled') return data;

    // Move records to Unfiled
    for (const record of data.records) {
        if (record.category === categoryName) {
            record.category = 'Unfiled';
        }
    }

    // Remove category
    data.categories = data.categories.filter(c => c !== categoryName);
    return data;
}

/**
 * Rename a category
 */
function renameCategory(data, oldName, newName) {
    if (oldName === 'Unfiled') return data;

    // Update records
    for (const record of data.records) {
        if (record.category === oldName) {
            record.category = newName;
        }
    }

    // Update categories list
    const idx = data.categories.indexOf(oldName);
    if (idx !== -1) {
        data.categories[idx] = newName;
    }

    return data;
}

/**
 * Get records grouped by category
 */
function getRecordsByCategory(data) {
    const groups = new Map();

    // Initialize all categories
    for (const cat of data.categories) {
        groups.set(cat, []);
    }

    // Group records
    for (const record of data.records) {
        const cat = record.category || 'Unfiled';
        if (!groups.has(cat)) {
            groups.set(cat, []);
        }
        groups.get(cat).push(record);
    }

    return groups;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        STORAGE_KEY, createDefaultData, generateId,
        loadData, saveData, debouncedSave,
        exportToText, importFromText, downloadTextFile, readTextFile,
        createRecord, deleteRecord, findRecord, updateRecord,
        addCategory, deleteCategory, renameCategory, getRecordsByCategory
    };
}
