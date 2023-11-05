// mihai Sirbu
// i didn't comment much this code since it's very similar to the lab 5, just modified for both tables and updated the db ( instead of printing to console)

const sqlite3 = require('sqlite3').verbose();
const math = require('mathjs');

const db = new sqlite3.Database('webpages.db');

let urlIndex = {};

// adding pagerank to our database ( adding hte table)
db.serialize(() => {
    db.run("ALTER TABLE pages_fruits ADD COLUMN pagerank REAL", (err) => { 
        if (err && !err.message.includes('duplicate column name')) {
            console.error("DB Error:", err.message);
        }
    });
    db.run("ALTER TABLE pages_personal ADD COLUMN pagerank REAL", (err) => { 
        if (err && !err.message.includes('duplicate column name')) {
            console.error("DB Error:", err.message);
        }
    });
});

function enumerateURLs(pageTableName, callback) {
    db.all(`SELECT url FROM ${pageTableName}`, [], (err, rows) => {
        if (err) {
            throw err;
        }

        // Enumerate URLs
        let index = 0;
        rows.forEach((row) => {
            urlIndex[row.url] = index;
            index++;
        });

        callback();
    });
}

function constructAdjacencyMatrix(linkTableName, callback) {
    const n = Object.keys(urlIndex).length;
    // making the initial matrix with 0's
    let matrix = math.zeros(n, n);

    db.all(`SELECT source_url, dest_url FROM ${linkTableName}`, [], (err, rows) => {
        if (err) {
            throw err;
        }
        // change our 0's matrix into 1's where there is a link
        rows.forEach((row) => {
            if (urlIndex[row.source_url] !== undefined && urlIndex[row.dest_url] !== undefined) {
                matrix.subset(math.index(urlIndex[row.source_url], urlIndex[row.dest_url]), 1);
            }
        });

        callback(matrix);
    });
}

// bringing the matrix to the Probability values of the jump
function normalizeMatrix(A) {
    const n = A.size()[0];
    const alpha = 0.1;
    const alphaMatrix = math.multiply(math.ones(n, n), alpha / n);

    let M = math.clone(A);
    for (let j = 0; j < n; j++) {
        let colSum = math.sum(M.subset(math.index(math.range(0, n), j)));
        if (colSum === 0) {
            M.subset(math.index(math.range(0, n), j), Array(n).fill(1 / n));
        } else {
            let normalizedColumn = math.divide(M.subset(math.index(math.range(0, n), j)), colSum);
            M.subset(math.index(math.range(0, n), j), normalizedColumn);
        }
    }

    const P = math.add(math.multiply(M, 1 - alpha), alphaMatrix);
    return P;
}

function calculatePageRank(matrix, tableName) {
    const P = normalizeMatrix(matrix);
    // getting original x0 matrix to which we will multiply our P
    let x0 = math.transpose([Array(matrix.size()[0]).fill(1/matrix.size()[0])]);
    let x_prev = math.clone(x0);

    while (true) {
        x0 = math.multiply(P, x0);
        if (euclideanDistance(x0, x_prev) < 0.0001) {
            break;
        }
        x_prev = math.clone(x0);
    }

    const ranks = x0.toArray().map((value, index) => ({ index, value: value[0] }));
    let reverseUrlIndex = {};
    for (let url in urlIndex) {
        reverseUrlIndex[urlIndex[url]] = url;
    }
    // udding the actual rank values into the db
    ranks.forEach((rank) => {
        const url = reverseUrlIndex[rank.index];
        const pagerankValue = rank.value;
        db.run(`UPDATE ${tableName} SET pagerank = ? WHERE url = ?`, [pagerankValue, url], (err) => {
            if (err) {
                console.error(`Error updating pagerank for ${url}:`, err);
            }
        });
    });
}

function euclideanDistance(matrixA, matrixB) {
    const diff = math.subtract(matrixA, matrixB);
    return math.sqrt(math.sum(math.dotMultiply(diff, diff)));
}

const tableNamesList = [
    { pages: "pages_fruits", links: "links_fruits" },
    { pages: "pages_personal", links: "links_personal" }
];

function processTable(tableNames) {
    urlIndex = {};

    enumerateURLs(tableNames.pages, () => {
        console.log(`URLs have been enumerated for ${tableNames.pages}.`);
        console.log(urlIndex);

        constructAdjacencyMatrix(tableNames.links, (matrix) => {
            console.log(`Made Adjacency matrix for ${tableNames.links}.`);
            calculatePageRank(matrix, tableNames.pages);
            
            const nextTable = tableNamesList.shift();
            if (nextTable) {
                processTable(nextTable);
            } else {
                db.close();
            }
        });
    });
}

const firstTable = tableNamesList.shift();
if (firstTable) {
    processTable(firstTable);
}