/**
 * MathPad Storage - localStorage persistence and import/export
 */

const STORAGE_KEY = 'mathpad_data';
const STORAGE_VERSION = 2;

/**
 * Strip the three "appended by solveRecord" sections from a record's text:
 *   "--- Table Outputs ---"
 *   "*--- Solve Trace ---"
 *   "*--- Reference Constants and Functions ---"
 * Matches the leftmost marker and eats from there to EOF, so all three
 * appended sections come off in a single pass. Used on initial load and
 * when editing the formulas; persistence (saveData, driveSaveFile) calls
 * cleanDataForSave below to keep these display artifacts out of storage.
 */
const STALE_SECTIONS_RE = /\n*"\*?--- (Table Outputs|Solve Trace|Reference Constants and Functions) ---"[\s\S]*$/;
function stripStaleSections(text) {
    return text.replace(STALE_SECTIONS_RE, '');
}

/**
 * Return a save-ready shallow clone of `data` with each record's text
 * stripped of the appended Tables/Trace/References sections. The in-memory
 * data object is left untouched so the editor keeps showing its current
 * value within the session.
 */
function cleanDataForSave(data) {
    if (!data || !data.records) return data;
    return {
        ...data,
        records: data.records.map(r => ({ ...r, text: stripStaleSections(r.text) }))
    };
}

const DEFAULT_SETTINGS_RECORD = {
    title: 'Default Settings',
    text: `"New Record"

--Variables--

"*This is the template for new records"

"The first line is the default title for new records. This record's settings (for example Decimal Places) are also used as defaults for new records."

"Generally, put functions and equations above the --Variables-- section.  Variable definitions can go here in the --Variables-- section or above it.  When in the Variables section, they'll be visible in the variables panel."`,
    category: 'Reference',
    places: 4,
    stripZeros: true,
    groupDigits: true,
    format: 'float',
    degreesMode: false,
    currencySymbol: '$'
};

/**
 * Default data structure
 */
function createDefaultData() {
    // Generate Loan record ID first so we can set it as the initial record
    const loanRecordId = generateId();

    return backfillRecordTimestamps({
        version: STORAGE_VERSION,
        records: [
            {
                id: generateId(),
                title: 'Example: Retirement Calculator',
                text: `"Retirement Calculator"

--Functions--
"Time Value of Money"
pmt2(pv; rate; n; fv) = (pv - fv / (1 + rate)**n) * rate / (1 - (1 + rate)**-n)

"Total accumulation of a rate applied to a balance which increases by gain% every period"
{
  tot(pv; gain; rate; periods) =
    if(gain == 0; pv * rate * periods; pv * rate * ((1 + gain)**periods - 1) / gain)
//     if(periods == 0; 0; pv * rate + tot(pv * (1 + gain); gain; rate; periods - 1))
}

"Total fees paid given total payment"
fees(pv; fv; totPmt; return; fees) = fees * (totPmt + fv - pv) / (return - fees)

--Equations--
"Future value of account(s)"
fv = pv * (1 + gain)**years

"Variable payments"
pmtRate = return - fees - gain
totVPmt = tot(pv; gain; pmtRate; years)
totVFees = fees(pv; fv; totVPmt; return; fees)
year1 = pv * pmtRate / 12
yearN = pv * (1 + gain)**(years - 1) * pmtRate / 12

"Fixed payments"
fixedPmt = pmt2(pv; return - fees; years; fv) / 12
totFPmt = fixedPmt * years * 12
totFFees = fees(pv; fv; totFPmt; return; fees)

--Variables--
"*Calculates fixed or variable monthly retirement withdrawals"
"Enter present value, years, gain (or future value), fees, and annual return; then click the Solve button.  Correct orange results by pressing \u27F2 next to one of the orange values."



"Present value of retirement account(s):"
pv $<- $1,000,000

"Life expectancy:"
years <- 20

"Enter net annual account(s) gain or future value:"
gain %<- 1%
fv $<-


"Annual management fees (percentage):"
fees %<- 0.65%

"Total expected annual return:"
return %<- 6.65%


"*Variable payments (grows with balance each year)"

"Payment rate:"
pmtRate %<- 5%

"First year monthly payments:"
year1 $->

"Last year monthly payments:"
yearN $->

"Total of variable payments:"
totVPmt $->

"Total fees paid:"
totVFees $->


"*Fixed payments (same every year)"

"Monthly payments"
fixedPmt $->

"Total of fixed payments"
totFPmt $->

"Total fees paid"
totFFees $->


"*Notes:"
"Values that are interdependent may appear orange after solving.  This indicates that one of them must be adjusted to balance with the others.  Click \u27F2 next to an orange value to adjust it.  All green means all values are balanced."`,
                category: 'Finance',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: false,

            },
            {
                id: loanRecordId,
                title: 'Example: Loan Calculator',
                text: `"Loan calculator"

--Functions--
pmt2(pv; fv; rate; n; pmtDue) = -(pv + fv/(1 + rate)**n)*rate / ((1 - (1 + rate)**-n)*(1 + rate)**pmtDue)

--Equations--
// these variables never get orange highlighting because they are "solved" here
pmtDue = pmtDue
cmpndsYr = cmpndsYr
pmtsYr = pmtsYr

// r is substituted into later equations
r = (1 + rate/cmpndsYr)**(cmpndsYr/pmtsYr) - 1

// all vars below may get orange highlighting (except r which is not an input var)
pmt = pmt2(pv; fv; r; years*pmtsYr; pmtDue)
pmt + extraPmt = pmt2(pv; fv; r; actYears*pmtsYr; pmtDue)

--Hidden Variables--
lastPmt: round(actYears*pmtsYr - pmtDue)
totPmt: pmt + extraPmt
begin: 1
end: 0

// Begin variables (top) panel
--Variables--
"*Update values, then click solve or the solve ⟲ icon next to a highlighted variable"
"For example, set Present Value to $200,000 and press the solve ⟲ icon next to Payment"

Present Value pv $: $100,000
Future Value fv $: $0              "(balloon payment)"
Annual Rate rate %: 6.125%
Years years : 30
Payment pmt $:


Extra Payment extraPmt $: $0        "Extra principal payment per period"
Actual Years actYears : years            "Actual years given extra principal payment"


Payments/Year pmtsYr: 12
Compounds/Year cmpndsYr: pmtsYr          "generally equals payments/year"
Annuity Due pmtDue[0..1]: end            "end or begin of period"



"*Graphs and tables"

tableGraph("v Balance over \\actYears\\ year(s) at \\rate%\\, payment = \\pmt$\\, extra payment = \\extraPmt$\\") = {
  pmtNum: 0..lastPmt
  interest: if(pmtNum == 0; 0; round(-balance~ * r; 2)) // round to cents
  totInterest: if(pmtNum == 0; 0; totInterest~ + interest)
  principal: if(pmtNum == 0; pmtDue*totPmt; if(pmtNum == lastPmt; -balance~; totPmt - interest))
  balance: if(pmtNum == 0; pv + pmtDue*totPmt; balance~ + principal)
  year: (pmtNum)/pmtsYr
  "Year" year->
  "Principal Balance" balance$->
  "Total Interest" -totInterest$->
}



grid("v Payment for \\pv$\\ loan at various rates and loan lengths") = {
  // need to repeat equations to remove dependence on extra payments
  pmt = pmt2(pv; fv; r; years*pmtsYr; pmtDue)
  r = (1 + rate/cmpndsYr)**(cmpndsYr/pmtsYr) - 1
  rate: rate-0.5%..rate+0.5%..0.0625%
  years: 5..30..5
  pmt<-
  Rate rate%->
  Years years->
  Payment pmt$->
}



table("v Amortization Schedule for \\actYears\\ year(s) at \\rate%\\, extra payment = \\extraPmt$\\") = {
  pmtNum: 0..lastPmt
  interest: if(pmtNum == 0; 0; round(-balance~ * r; 2)) // round to cents
  totInterest: if(pmtNum == 0; 0; totInterest~ + interest)
  principal: if(pmtNum == 0; pmtDue*totPmt; if(pmtNum == lastPmt; -balance~; totPmt - interest))
  balance: if(pmtNum == 0; pv + pmtDue*totPmt; balance~ + principal)
  year: floor((pmtNum - 1)/pmtsYr) + 1
  payment: principal + interest

  "Pmt#" pmtNum->
  "Year" year->
  "Payment" payment$->
  "Principal" principal$->
  "Interest" interest$->
  "Balance" balance$->
  "Total Interest" totInterest$->
}

"*Notes:"
"Values that are interdependent may appear orange after solving.  This indicates that one of them must be adjusted to balance with the others.  Click ⟲ next to an orange value to adjust it.  All green means all values are balanced."
`,
                category: 'Finance',
                places: 4,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Quadratic',
                text: `"Quadratic equation"
  "ax^2 + bx + c = 0"

--Variables--
"*Press Solve to solve the equation. Try different values for a, b, and c."

a: -1
b: 6
c: 4


"*Here are the equations:"

disc = b**2 - 4*a*c
x1 = (-b + sqrt(disc)) / (2*a)
x2 = (-b - sqrt(disc)) / (2*a)

disc->
x1->
x2->


tableGraph("Quadratic equation \\a\\*x^2 + \\b\\x + \\c\\") = {
  x: min(x1; x2)-1..max(x1; x2)+1..0.1
  y: a*x**2 + b*x + c
  x->
  y->
}
`,
                category: 'Math',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Factorial',
                text: `"Factorial"
  "Recursive and non-recursive solutions"

--Variables--
"*Factorial of n is the product of all integers from 1 to n:"
"  n! = 1 * 2 * 3 * ... * n
  Note: 170! is the largest factorial that fits in a floating point number"


"Here we develop a recursive function fac(n)"
      fac(n) = if(n <= 1; 1; n * fac(n - 1))
  fac(170)->

"Here we provide a solution using the built-in prod function"
  prod(k; k; 1; 170)->

"There is also a built-in fact function"
  fact(170)->`,
                category: 'Math',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Fifth Degree Polynomial',
                text: `"Fifth degree polynomial"

Coefficients
c5: 1
c4: -2
c3: -10
c2: 20
c1: 9
c0: -14

Polynomial function
f(x; c5; c4; c3; c2; c1; c0) = c5*x**5 + c4*x**4 + c3*x**3 + c2*x**2 + c1*x + c0

--Variables--

"*Press Solve to find all 5 roots and graph the function"

Root-finding equation to be solved
f(x; c5; c4; c3; c2; c1; c0) = 0

Roots
x->                           "Default root near zero"
x[2:2.5]->                    "Search for root in range 2 to 2.5"
x[2.5:3]->                    "-> Solves to record's default precision"
x[-1:0]->>                    "->> Shows full precision"
x[-4:-2]->

tableGraph("f(x) showing roots") = {
  x: -3.1..3.1..0.2
  // this equation overrides the root-finding one above in the main body
  // otherwise there would be solve failures when f(x) != 0
  y = f(x; c5; c4; c3; c2; c1; c0)
  "x axis label" x->
  "y axis label" y->
}`,
                category: 'Math',
                places: 4,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: "Example: Ohm's Law",
                text: `"Ohm's Law"

v = i*r
w = v*i

--Variables--
"*Enter any two then press solve for the other two"


v:          "volts"
i:          "amps"
r: 8        "ohms"
w: 200      "watts"

tableGraph("v Watts vs amps at typical speaker resistances") = {
  r: 2..10..2
  w: 20..400..10
  v<-
  i<-
  Watts w->
  Ohms r->
  Amps i->
}
tableGraph("v Watts vs volts at typical speaker resistances") = {
  r: 2..10..2
  w: 20..400..10
  v<-
  i<-
  Watts w->
  Ohms r->
  Volts v->
}
`,
                category: 'Science',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Basel Series',
                text: `"Basel Series"
  "Recursive and non-recursive solutions"

--Variables--
"*The Basel series is the sum of 1/n**2 where n goes from 1 to infinity"

"It is equal to pi**2/6"
  pi**2/6->               "(to 8 places)"


"Here we develop a recursive basel function"
      basel(low; high) = if(low > high; 0; 1/low**2 + basel(low+1; high))

"We are limited to how high n can go by the recursion limit"
  basel(1; 750)->


"Here we develop a solution using the built-in sum function"
"Since sum is not subject to recursion limits we can sum to much higher n"
  sum(1/n**2; n; 1; 10000000)->`,
                category: 'Math',
                places: 8,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Constants',
                text: `"Physical and mathematical constants"

--Variables--
"*Constants defined here are available in all records"

pi: 3.141592653589793
e: 2.71828182845905
c: 299792458 "speed of light m/s"
G: 6.67430e-11 "gravitational constant"
h: 6.62607015e-34 "Planck constant"
kB: 1.380649e-23 "Boltzmann constant"
NA: 6.02214076e23 "Avogadro number"
golden: 1.61803398874989 "golden ratio"

secsPerHour: 3600
secsPerDay: 86400`,
                category: 'Reference',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Functions',
                text: `"User-defined functions"

--Variables--
"*Functions defined here are available in all records"


"Time Value of Money"
pmt(pv; rate; n; fv) = -(pv + fv / (1 + rate)**n) * rate / (1 - (1 + rate)**-n)


"Compound interest"
compound(pv; rate; n) = pv * (1 + rate)**n


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

            },
            { id: generateId(), ...DEFAULT_SETTINGS_RECORD }
        ],
        categories: ['Unfiled', 'Finance', 'Math', 'Science', 'Reference', 'Personal'],
        settings: {
            lastRecordId: loanRecordId
        }
    });
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
// Sentinel timestamp for legacy records that don't have a real creation date
// (April 1, 2026 03:14:15.926 UTC — pi-themed placeholder)
const DEFAULT_RECORD_TIMESTAMP = Date.UTC(2026, 3, 1, 3, 14, 15, 926);

/**
 * Backfill missing created timestamps with the sentinel default.
 * Used for legacy records that predate timestamp tracking.
 * Modified is left blank if not set.
 */
function backfillRecordTimestamps(data) {
    if (!data || !data.records) return data;
    for (const record of data.records) {
        if (record.created == null) record.created = DEFAULT_RECORD_TIMESTAMP;
    }
    return data;
}

function loadData() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            // Migrate data if needed
            if (!data.version || data.version < STORAGE_VERSION) {
                return backfillRecordTimestamps(migrateData(data));
            }
            // Ensure Default Settings exists even for current version
            ensureDefaultSettingsRecord(data);
            return backfillRecordTimestamps(data);
        }
    } catch (e) {
        console.error('Error loading data from localStorage:', e);
        alert('Error loading saved data. Starting with defaults.\n\n' + e.message);
    }

    return createDefaultData();
}

/**
 * Save data to localStorage
 */
function saveData(data, localOnly = false) {
    try {
        // Save sidebar scroll position (skip during data reload to preserve Drive value)
        if (typeof UI !== 'undefined' && UI.initComplete) {
            const sidebarContent = document.querySelector('.sidebar-content');
            if (sidebarContent && data.settings) {
                data.settings.sidebarScrollTop = sidebarContent.scrollTop;
            }
        }
        data.version = STORAGE_VERSION;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanDataForSave(data)));
        if (!localOnly) markDriveDirty();
        return true;
    } catch (e) {
        console.error('Error saving data to localStorage:', e);
        if (e.name === 'QuotaExceededError') {
            alert('Storage quota exceeded. Please export and delete some records.');
        } else {
            alert('Error saving data: ' + e.message);
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
        saveData(data, true);
    }
}
function cancelPendingSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        resched = true;
    }
}
function debouncedSave(data, delay = 500, localOnly = false) {
    if (!UI.initComplete) return;
    if (!localOnly) markDriveDirty();
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
        lines.push(`Format = "${record.format || 'float'}"; GroupDigits = ${record.groupDigits ? 1 : 0}; DegreesMode = ${record.degreesMode ? 1 : 0}${record.currencySymbol && record.currencySymbol !== '$' ? `; CurrencySymbol = "${record.currencySymbol}"` : ''}`);
        if (record.status) {
            // Escape quotes and newlines in status message
            const escapedStatus = record.status.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            lines.push(`Status = "${escapedStatus}"; StatusIsError = ${record.statusIsError ? 1 : 0}`);
        }
        if (record.created || record.modified) {
            const c = record.created ? new Date(record.created).toISOString() : '';
            const m = record.modified ? new Date(record.modified).toISOString() : '';
            lines.push(`Created = "${c}"; Modified = "${m}"`);
        }

        // Reference records have their title stripped on import, so add it back
        if (record.title && isReferenceTitle(record.title)) {
            lines.push(`"${record.title}"`);
        }

        // Record content (strip trailing blank lines for consistency with
        // import). Use a newline-only strip — `trimEnd()` would also strip
        // tabs, eating table-output rows whose cells are all empty.
        lines.push(record.text.replace(/\n+$/, ''));

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
        let currencySymbol = '$';
        let status = '';
        let statusIsError = false;
        let created = null;
        let modified = null;
        let contentStart = 0;

        // Parse metadata lines
        for (let i = 0; i < Math.min(5, lines.length); i++) {
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

            // Format, GroupDigits, DegreesMode line (later fields optional; ShadowConstants accepted but ignored)
            const formatMatch = line.match(/Format\s*=\s*"([^"]*)"\s*;\s*GroupDigits\s*=\s*(\d+)(?:\s*;\s*DegreesMode\s*=\s*(\d+))?(?:\s*;\s*ShadowConstants\s*=\s*(\d+))?(?:\s*;\s*CurrencySymbol\s*=\s*"([^"]*)")?/i);
            if (formatMatch) {
                format = formatMatch[1];
                groupDigits = formatMatch[2] === '1';
                if (formatMatch[3] !== undefined) {
                    degreesMode = formatMatch[3] === '1';
                }
                // formatMatch[4] is ShadowConstants — accepted for backwards compatibility, ignored
                if (formatMatch[5] !== undefined) {
                    currencySymbol = formatMatch[5];
                }
                contentStart = i + 1;
                continue;
            }

            // Status line (new in v3)
            const statusMatch = line.match(/Status\s*=\s*"(.*)"\s*;\s*StatusIsError\s*=\s*(\d+)/i);
            if (statusMatch) {
                // Unescape quotes and newlines in status message
                status = statusMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
                statusIsError = statusMatch[2] === '1';
                contentStart = i + 1;
                continue;
            }

            // Created/Modified timestamps (ISO format)
            const datesMatch = line.match(/Created\s*=\s*"([^"]*)"\s*;\s*Modified\s*=\s*"([^"]*)"/i);
            if (datesMatch) {
                if (datesMatch[1]) {
                    const t = Date.parse(datesMatch[1]);
                    if (!isNaN(t)) created = t;
                }
                if (datesMatch[2]) {
                    const t = Date.parse(datesMatch[2]);
                    if (!isNaN(t)) modified = t;
                }
                contentStart = i + 1;
                continue;
            }
        }

        // Rest is content
        const contentLines = lines.slice(contentStart);
        const content = contentLines.join('\n').trimEnd();

        if (!content) continue;

        // Extract title from first comment line if present
        let title = '';
        let textContent = content;
        const firstLine = contentLines[0].trim();
        if (firstLine.startsWith('"')) {
            // Title from quoted comment (single-line or multi-line)
            title = firstLine.slice(1).replace(/"$/, '');
            // For reference records, remove title line from content to avoid duplication
            // (export adds the title line, so we remove it on import)
            const isRefRecord = isReferenceTitle(title);
            if (isRefRecord) {
                textContent = contentLines.slice(1).join('\n').trimEnd();
            }
        } else if (firstLine) {
            title = firstLine.substring(0, 30);
            if (firstLine.length > 30) title += '...';
        } else {
            title = 'Untitled';
        }

        const recordId = generateId();
        if (selected) {
            selectedRecordIndex = records.length;
        }
        const recordObj = {
            id: recordId,
            title: title,
            text: textContent,
            category: category,
            places: places,
            stripZeros: stripZeros,
            groupDigits: groupDigits,
            format: format,
            degreesMode: degreesMode,
            currencySymbol: currencySymbol,
            status: status,
            statusIsError: statusIsError
        };
        if (created != null) recordObj.created = created;
        if (modified != null) recordObj.modified = modified;
        records.push(recordObj);
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
        text: ds.text.split('\n').slice(0, 3).join('\n') + '\n',
        category: 'Unfiled',
        places: ds.places,
        stripZeros: ds.stripZeros,
        groupDigits: ds.groupDigits,
        format: ds.format,
        degreesMode: ds.degreesMode,
        currencySymbol: ds.currencySymbol || '$',
        status: '',
        statusIsError: false,
        created: Date.now(),
        modified: null
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
    const sortPrefs = (data.settings && data.settings.categorySortOrder) || {};

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

    // Apply per-category sort
    for (const [cat, records] of groups) {
        if (sortPrefs[cat] === 'alpha') {
            records.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        }
    }

    return groups;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        STORAGE_KEY, createDefaultData, isReferenceRecord, isReferenceTitle, generateId,
        loadData, saveData, debouncedSave, stripStaleSections, cleanDataForSave,
        exportToText, importFromText, downloadTextFile, readTextFile,
        createRecord, deleteRecord, findRecord, updateRecord,
        addCategory, deleteCategory, renameCategory, getRecordsByCategory
    };
}
