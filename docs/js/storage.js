/**
 * MathPad Storage - localStorage persistence and import/export
 */

const STORAGE_KEY = 'mathpad_data';
const STORAGE_VERSION = 2;

const DEFAULT_SETTINGS_RECORD = {
    title: 'Default Settings',
    text: `"New Record"

--Variables--
"*Template for new records"

"First line becomes the default title"

"Settings are used as defaults for new records"`,
    category: 'Reference',
    places: 4,
    stripZeros: true,
    groupDigits: true,
    format: 'float',
    degreesMode: false,
    shadowConstants: false
};

/**
 * Default data structure
 */
function createDefaultData() {
    // Generate Retirement record ID first so we can set it as the initial record
    const retirementRecordId = generateId();

    return {
        version: STORAGE_VERSION,
        records: [
            {
                id: retirementRecordId,
                title: 'Example: Retirement Calculator',
                text: `"Retirement Calculator"

--Equations--
"TVM calculation"
pmt = -(-pv + fv / (1 + mint)**n) * mint / (1 - (1 + mint)**-n)
"Number of periods"
n = years * 12
"Annual return net of fees"
return - fees = mint * 12
"Future value of account(s)"
fv = pv * (1 + gain)**years
"Number of solves"
solveCount: solveCount + 1
solveCount=> 0 // Use => to persist across clears

--Variables--
"*Update value(s), then re-calculate any variable by clicking its solve icon \u27F2"


"Enter present value of retirement account(s):"
pv$: $1,000,000

"Enter life expectancy:"
years: 20

"Enter the payment to receive each month:"
pmt$: $5,000

"Enter net annual account(s) appreciation:"
gain%: 2%

"Enter management fees:"
fees%: 0.65%

"Enter gross annual return:"
return%: 7.76%

"Future value of account(s)"
fv$-> $1,485,947.40`,
                category: 'Finance',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: false,
                shadowConstants: false
            },
            {
                id: generateId(),
                title: 'Example: TVM',
                text: `"Time Value of Money"

"Payment calculation"
pmt = -(pv + fv / (1 + mint)**n) * mint / (1 - (1 + mint)**-n)

"Monthly interest rate from annual"
mint = yint / 12

--Variables--
"*Update value(s), then re-calculate any variable by clicking its solve icon \u27F2"


pmt$: "monthly payment"
pv$: $100,000 "loan amount"
fv$: 0 "future value (balloon payment)"
yint%: 6.125% "annual interest rate %"
n: 360 "number of payments (30 years)"
`,
                category: 'Finance',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,
                shadowConstants: false
            },
            {
                id: generateId(),
                title: 'Example: Quadratic',
                text: `"Quadratic equation"
  "ax^2 + bx + c = 0"

--Variables--
"*Press Solve to solve the equation. Try different values for a, b, and c."

a: 1
b: -5
c: 6
disc->
x1->
x2->


"*Here are the equations:"

disc = b**2 - 4*a*c
x1 = (-b + sqrt(disc)) / (2*a)
x2 = (-b - sqrt(disc)) / (2*a)
`,
                category: 'Math',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,
                shadowConstants: true
            },
            {
                id: generateId(),
                title: 'Example: Basel Series',
                text: `"Basel Series"
  "Recursive and non-recursive solutions"

--Variables--
"*The Basel series is the sum of 1/n**2 where n goes from 1 to infinity"

"It is equal to pi**2/6"
  pi**2/6-> "(to 10 places)"


"Here we develop a recursive solution"
"We are limited to how high n can go by the recursion limit"
"First define the function:"
  basel(low; high) = if(low > high; 0; 1/low**2 + basel(low+1; high))
  basel(1; 750)->


"Here we develop a solution using the built-in sum function"
"Since sum is not subject to recursion limits we can sum to much higher n"
  sum(1/n**2; n; 1; 10000000)->

"--- Reference Constants and Functions ---"
pi: 3.141592653589793`,
                category: 'Math',
                places: 10,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,
                shadowConstants: true
            },
            {
                id: generateId(),
                title: 'Example: Factorial',
                text: `"Factorial"
  "Recursive and non-recursive solutions"

--Variables--
"*Factorial of n is the product of all integers from 1 to n"
"n! = 1 * 2 * 3 * ... * n"
"Note: 170! is the largest factorial that fits in a floating point number"


"Here we develop a recursive solution"
  fac(n) = if(n <= 1; 1; n * fac(n - 1))
  fac(170)->

"Here we develop a solution using the built-in prod function"
  prod(k; k; 1; 170)->

"There is also a built-in fact function"
  fact(170)->`,
                category: 'Math',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,
                shadowConstants: true
            },
            {
                id: generateId(),
                title: 'Example: Fifth Degree Polynomial',
                text: `"Fifth degree polynomial"

c5: 1
c4: -2
c3: -10
c2: 20
c1: 9
c0: -14
f(x; c5; c4; c3; c2; c1; c0) = c5*x**5 + c4*x**4 + c3*x**3 + c2*x**2 + c1*x + c0

--Variables--
"*Press Solve to compute all 5 roots"



f(x1; c5; c4; c3; c2; c1; c0) = 0
x1->

f(x2; c5; c4; c3; c2; c1; c0) = 0
x2[2:2.5]-> "search for solution in range 2 to 2.5"

f(x3; c5; c4; c3; c2; c1; c0) = 0
x3[2.5:3]-> "-> solves to record's default precision"

f(x4; c5; c4; c3; c2; c1; c0) = 0
x4[-1:0]->> "->> provides full precision"

f(x5; c5; c4; c3; c2; c1; c0) = 0
x5[-4:-2]->>`,
                category: 'Math',
                places: 4,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,
                shadowConstants: true
            },
            {
                id: generateId(),
                title: 'Constants',
                text: `"Physical and mathematical constants"

--Variables--
"*Constants defined here are available in all records"
" (unless 'Shadow constants' is set for the record)"

pi: 3.141592653589793
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
                format: 'float',
                degreesMode: false,
                shadowConstants: true
            },
            {
                id: generateId(),
                title: 'Functions',
                text: `"User-defined functions"

--Variables--
"*Functions defined here are available in all records"


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
                format: 'float',
                degreesMode: false,
                shadowConstants: false
            },
            { id: generateId(), ...DEFAULT_SETTINGS_RECORD }
        ],
        categories: ['Unfiled', 'Finance', 'Math', 'Science', 'Reference', 'Personal'],
        settings: {
            lastRecordId: retirementRecordId
        }
    };
}

/**
 * Generate a unique ID
 */
/**
 * Check if a record is a special reference record (Constants, Functions, or Default Settings)
 * @param {object} record - The record to check
 * @param {string} [title] - Optional: check for a specific reference record title
 */
function isReferenceRecord(record, title) {
    if (record.category !== 'Reference') return false;
    if (title) return record.title === title;
    return record.title === 'Constants' || record.title === 'Functions' || record.title === 'Default Settings';
}

/**
 * Check if a record title is a reference record title
 */
function isReferenceTitle(title) {
    return title === 'Constants' || title === 'Functions' || title === 'Default Settings';
}

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
            // Ensure Default Settings exists even for current version
            ensureDefaultSettingsRecord(data);
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

    // Ensure Default Settings record exists
    ensureDefaultSettingsRecord(data);

    data.version = STORAGE_VERSION;
    return data;
}

/**
 * Ensure Default Settings record exists
 */
function ensureDefaultSettingsRecord(data) {
    if (!data.records) {
        data.records = [];
    }
    const hasDefaultSettings = data.records.some(r => isReferenceRecord(r, 'Default Settings'));
    if (!hasDefaultSettings) {
        data.records.push({ id: generateId(), ...DEFAULT_SETTINGS_RECORD });
    }
}

/**
 * Debounced save function
 */
let saveTimeout = null;
let resched = true;
function doSave(data, delay) {
    if (resched) {
        resched = false;
        saveTimeout = setTimeout(() => {
            doSave(data, delay);
        }, delay);
    } else {
        saveTimeout = null;
        resched = true;
        saveData(data);
    }
}
function debouncedSave(data, delay = 500) {
    if (saveTimeout) {
        resched = true;
    } else {
        doSave(data, delay);
    }
}

/**
 * Export data to MpExport text format
 * Compatible with original MathPad export format
 * @param {object} data - The data to export
 * @param {object} options - Export options
 * @param {number} options.selectedRecordId - ID of currently selected record (optional)
 */
function exportToText(data, options = {}) {
    const SEPARATOR = '~~~~~~~~~~~~~~~~~~~~~~~~~~~';
    const lines = [];
    const { selectedRecordId } = options;

    for (const record of data.records) {
        // Record metadata
        const isSelected = selectedRecordId && record.id === selectedRecordId;
        const selectedFlag = isSelected ? '; Selected = 1' : '';
        lines.push(`Category = "${record.category || 'Unfiled'}"; Secret = ${record.secret ? 1 : 0}${selectedFlag}`);
        lines.push(`Places = ${record.places != null ? record.places : 4}; StripZeros = ${record.stripZeros !== false ? 1 : 0}`);
        lines.push(`Format = "${record.format || 'float'}"; GroupDigits = ${record.groupDigits ? 1 : 0}; DegreesMode = ${record.degreesMode ? 1 : 0}; ShadowConstants = ${record.shadowConstants ? 1 : 0}`);
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

        // Record content (strip trailing blank lines for consistency with import)
        lines.push(record.text.trimEnd());

        // Separator
        lines.push(SEPARATOR);
    }

    return lines.join('\n');
}

/**
 * Import data from MpExport text format
 * @param {string} text - The text to import
 * @param {object} existingData - Existing data to merge with (or null for new)
 * @param {object} options - Import options
 * @param {boolean} options.clearExisting - If true, clear existing records before import
 */
function importFromText(text, existingData = null, options = {}) {
    // Normalize line endings: \r\n (Windows) and \r (classic Mac) to \n (Unix)
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const SEPARATOR = '~~~~~~~~~~~~~~~~~~~~~~~~~~~';
    const records = [];
    const chunks = text.split(SEPARATOR);
    let selectedRecordIndex = -1;

    for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;

        const lines = trimmed.split('\n');
        let category = 'Unfiled';
        let secret = false;
        let selected = false;
        let places = 4;
        let stripZeros = true;
        let format = 'float';
        let groupDigits = false;
        let degreesMode = false;
        let shadowConstants = false;
        let status = '';
        let statusIsError = false;
        let contentStart = 0;

        // Parse metadata lines
        for (let i = 0; i < Math.min(4, lines.length); i++) {
            const line = lines[i].trim();

            // Category, Secret, and optional Selected flag
            const catMatch = line.match(/Category\s*=\s*"([^"]*)"\s*;\s*Secret\s*=\s*(\d+)(?:\s*;\s*Selected\s*=\s*(\d+))?/i);
            if (catMatch) {
                category = catMatch[1];
                secret = catMatch[2] === '1';
                selected = catMatch[3] === '1';
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

            // Format, GroupDigits, DegreesMode, ShadowConstants line (later fields optional)
            const formatMatch = line.match(/Format\s*=\s*"([^"]*)"\s*;\s*GroupDigits\s*=\s*(\d+)(?:\s*;\s*DegreesMode\s*=\s*(\d+))?(?:\s*;\s*ShadowConstants\s*=\s*(\d+))?/i);
            if (formatMatch) {
                format = formatMatch[1];
                groupDigits = formatMatch[2] === '1';
                if (formatMatch[3] !== undefined) {
                    degreesMode = formatMatch[3] === '1';
                }
                if (formatMatch[4] !== undefined) {
                    shadowConstants = formatMatch[4] === '1';
                }
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
        let textContent = content;
        const firstLine = (contentLines[0] && contentLines[0].trim()) || '';
        const titleMatch = firstLine.match(/^"([^"]+)"$/);
        if (titleMatch) {
            title = titleMatch[1];
            // For reference records, remove title line from content to avoid duplication
            // (export adds the title line, so we remove it on import)
            const isRefRecord = isReferenceTitle(title);
            if (isRefRecord) {
                textContent = contentLines.slice(1).join('\n').trim();
            }
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

        const recordId = generateId();
        if (selected) {
            selectedRecordIndex = records.length;
        }
        records.push({
            id: recordId,
            title: title,
            text: textContent,
            category: category,
            places: places,
            stripZeros: stripZeros,
            groupDigits: groupDigits,
            format: format,
            degreesMode: degreesMode,
            shadowConstants: shadowConstants,
            status: status,
            statusIsError: statusIsError
        });
    }

    // Get the selected record ID if one was marked
    const selectedRecordId = selectedRecordIndex >= 0 ? records[selectedRecordIndex].id : null;

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

        // Clear existing records if requested, otherwise append
        if (options.clearExisting) {
            existingData.records = records;
        } else {
            existingData.records = [...existingData.records, ...records];
        }
        // Store selected record ID for UI to use
        if (selectedRecordId) {
            existingData.settings = existingData.settings || {};
            existingData.settings.lastRecordId = selectedRecordId;
        }
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
            degreesMode: false,
            lastRecordId: selectedRecordId
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
 * Create a new record using Default Settings as template if available
 */
function createRecord(data) {
    // Ensure Default Settings record exists, then use it as template
    ensureDefaultSettingsRecord(data);
    const ds = data.records.find(r => isReferenceRecord(r, 'Default Settings'));
    const title = ds.text.split('\n')[0].replace(/^"|"$/g, '') || 'New Record';

    return {
        id: generateId(),
        title,
        text: `"${title}"\n\n`,
        category: 'Unfiled',
        places: ds.places,
        stripZeros: ds.stripZeros,
        groupDigits: ds.groupDigits,
        format: ds.format,
        degreesMode: ds.degreesMode,
        shadowConstants: ds.shadowConstants,
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
        STORAGE_KEY, createDefaultData, isReferenceRecord, isReferenceTitle, generateId,
        loadData, saveData, debouncedSave,
        exportToText, importFromText, downloadTextFile, readTextFile,
        createRecord, deleteRecord, findRecord, updateRecord,
        addCategory, deleteCategory, renameCategory, getRecordsByCategory
    };
}
