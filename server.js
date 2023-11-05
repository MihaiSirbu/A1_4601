// Mihai Sirbu
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const db = new sqlite3.Database('webpages.db');
const app = express();
const PORT = 3000;

app.listen(PORT, async () => {
    console.log(`Server started on port ${PORT}`);
    await registerServer();
});


async function registerServer() {
    // the vm ip
    const serverUrl = '134.117.133.203:3000'; 

    axios.put('http://134.117.130.17:3000/searchengines', {
        request_url: serverUrl
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (response.status === 201) {
            console.log('Server registered successfully');
        } else if (response.status === 200) {
            console.log('Server already registered');
        }
    })
    .catch(error => {
        console.error('Error registering server:', error.response.data);
    });
}
// Separate handlers for each endpoint
app.get('/fruits', (req, res) => handleFruitsSearchRequest(req, res));
app.get('/personal', (req, res) => handlePersonalSearchRequest(req, res));
// this is for retreiving the page afterwards
app.get('/page-data/:site/:url', handlePageDataRequest);


const elasticlunr = require('elasticlunr');




// Initialize the index
var index = elasticlunr(function () {
    this.addField('content');
    this.addField('title');
    this.setRef('id');
});

// Function to add documents to the index
function addToIndex(page, id) {
    index.addDoc({
        'id': id,
        'title': page.title,
        'content': page.content
    });
}

// fruit search
function handleFruitsSearchRequest(req, res) {
    commonSearchHandler(req, res, 'fruits');
}

// personal seach
function handlePersonalSearchRequest(req, res) {
    commonSearchHandler(req, res, 'personal');
}

// both searches

function commonSearchHandler(req, res, site) {
    let q = req.query.q || '';
    let boost = req.query.boost === 'true';
    let limit = parseInt(req.query.limit) || 10;
    let format = req.query.format || 'html';

    limit = Math.min(Math.max(1, limit), 50);  // Clamp the limit between 1 and 50.

    performSearch(q, site, boost, limit).then(results => {
        if (format === 'json') {
            // Return the search results as JSON
            let jsonResults = results.map(result => {
                return {
                    name: "Mihai Sirbu", 
                    url: result.url,
                    title: result.title,
                    score: result.score,
                    pagerank: result.pr
                };
            });
            res.json(jsonResults);
        } else {
            // display search results
            let resultsHtml = results.map(result =>
                `<div>
                    URL: <a href="${result.url}">${result.url}</a><br>
                    Title: ${result.title}<br>
                    Search Score: ${result.score}<br>
                    PageRank: ${result.pr}<br>
                    Data: <a href="/page-data/${site}/${encodeURIComponent(result.url)}">View Data</a>
                </div>`
            ).join('<hr>');

            let formHtml = `
                <form id="searchForm" action="/${site}" method="GET">
                    <input type="text" name="q" placeholder="Search..." value="${q}">
                    <label for="boost">Boost with PageRank:</label>
                    <input type="checkbox" name="boost" value="true" ${boost ? "checked" : ""}>
                    <label for="limit">Result limit:</label>
                    <input type="number" name="limit" min="1" max="50" value="${limit}">
                    <button type="submit">Search</button>
                </form>
            `;

            res.send(generateHTML(site, formHtml, resultsHtml));
        }
    }).catch(error => {
        console.error(error);
        res.status(500).send('Internal Server Error');
    });
}



// Helper function to generate HTML
function generateHTML(site, formHtml, resultsHtml) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${site.charAt(0).toUpperCase() + site.slice(1)} Search Engine</title>
        </head>
        <body>
            <h1>${site.charAt(0).toUpperCase() + site.slice(1)} Search</h1>
            ${formHtml}
            <div id="results">
                ${resultsHtml}
            </div>
        </body>
        </html>
    `;
}

function handlePageDataRequest(req, res) {
    const site = req.params.site;
    const url = decodeURIComponent(req.params.url);

    // Fetch page data, including PageRank, incoming and outgoing links - we will need this for the "Extra info" link for each result
    const pageInfoQuery = `SELECT * FROM pages_${site} WHERE url = ?`;
    const incomingLinksQuery = `SELECT source_url FROM links_${site} WHERE dest_url = ?`;
    const outgoingLinksQuery = `SELECT dest_url FROM links_${site} WHERE source_url = ?`;

    db.get(pageInfoQuery, [url], (err, pageRow) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
        } else if (!pageRow) {
            return res.status(404).send('Page not found in database');
        }

        // Fetch incoming and outgoing links
        db.all(incomingLinksQuery, [url], (err, incomingRows) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Internal Server Error');
            }
            
            db.all(outgoingLinksQuery, [url], (err, outgoingRows) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Internal Server Error');
                }
                
                const incomingLinks = incomingRows.map(row => row.source_url);
                const outgoingLinks = outgoingRows.map(row => row.dest_url);
                const wordFrequency = computeWordFrequency(pageRow.content);

                // Render page data or send JSON based on request type
                if (req.query.format === 'json') {
                    res.json({
                        url: pageRow.url,
                        title: pageRow.title,
                        pagerank: pageRow.pagerank,
                        incomingLinks: incomingLinks,
                        outgoingLinks: outgoingLinks,
                        wordFrequency: wordFrequency
                    });
                } else {
                    let wordFrequencyHtml = Object.entries(wordFrequency)
                        .map(([word, count]) => `<div>${word}: ${count} times</div>`)
                        .join('');

                    let incomingLinksHtml = incomingLinks.map(link => `<div><a href="${link}">${link}</a></div>`).join('');
                    let outgoingLinksHtml = outgoingLinks.map(link => `<div><a href="${link}">${link}</a></div>`).join('');

                    res.send(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Page Data for ${pageRow.title}</title>
                        </head>
                        <body>
                            <div><strong>1.URL:</strong> <a href="${pageRow.url}">${pageRow.url}</a></div>
                            <h1>2.Title: ${pageRow.title}</h1>
                            <h2>Word Frequency</h2>
                            ${wordFrequencyHtml}
                            <h2>Incoming Links</h2>
                            ${incomingLinksHtml}
                            <h2>Outgoing Links</h2>
                            ${outgoingLinksHtml}
                        </body>
                        </html>
                    `);
                }
            });
        });
    });
}



function performSearch(q, tableName, boost, limit) {
    return new Promise((resolve, reject) => {
        let query = `SELECT url, title, content, pagerank, rowid FROM pages_${tableName}`;

        db.all(query, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                // Index the pages if not already indexed
                rows.forEach(row => addToIndex(row, row.rowid));

                // Perform the search
                var results = index.search(q, {
                    fields: {
                        title: {boost: 3},
                        content: {boost: 1}
                    },
                    bool: "AND",
                    expand: false
                });

                // Map the search results to include the necessary data
                var searchResults = results.map(function(result) {
                    var page = rows.find(row => row.rowid.toString() === result.ref);
                    return {
                        url: page.url,
                        score: result.score * (boost ? page.pagerank : 1), // Boosting with PageRank if enabled
                        title: page.title,
                        pr: page.pagerank,
                        dataLink: `/page-data/${tableName}/${encodeURIComponent(page.url)}?format=json` // Link to JSON data
                    };
                });

                // Sort by the final score if PageRank boosting is enabled
                if (boost) {
                    searchResults.sort((a, b) => b.score - a.score);
                }

                // Apply the limit after sorting by score
                searchResults = searchResults.slice(0, limit);

                resolve(searchResults);
            }
        });
    });
}


// need this by assignment specs since we will need to count the words 
function computeWordFrequency(content) {
    const wordCounts = {};
    const words = content.split(/\W+/).map(word => word.toLowerCase());

    words.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
    });

    return wordCounts;
}



