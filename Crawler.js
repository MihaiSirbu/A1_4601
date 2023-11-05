//Mihai Sirbu 101130855
const Crawler = require('crawler');
const sqlite3 = require('sqlite3').verbose();
const urlModule = require('url');

const db = new sqlite3.Database('webpages.db');

// Create tables if they don't exist -> this time we have 2 for p[ersonal and fruits
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS pages_fruits (url TEXT PRIMARY KEY, title TEXT, content TEXT)", checkError);
    db.run("CREATE TABLE IF NOT EXISTS links_fruits (source_url TEXT, dest_url TEXT, UNIQUE(source_url, dest_url))", checkError);

    db.run("CREATE TABLE IF NOT EXISTS pages_personal (url TEXT PRIMARY KEY, title TEXT, content TEXT)", checkError);
    db.run("CREATE TABLE IF NOT EXISTS links_personal (source_url TEXT, dest_url TEXT, UNIQUE(source_url, dest_url))", checkError);
});


function checkError(err) {
    if (err) {
        console.error("DB Error:", err.message);
    }
}

const crawledURLs = new Set();
const maxCrawlCount = 1000;

const fruitCrawlCount = { count: 0 };
const personalCrawlCount = { count: 0 };
const disallowedUrls = ["https://japan-dev.com/blog/japan-dev-salary-guide-2022"]; // this is because the personal website I chose when I get the robots.txt you cannot crawl this legally

const crawler = new Crawler({
    maxConnections: 10,
    rateLimit: 200, // implemented this because when crawling the personal site there's risk involved in getting banned so.. currently 0.1seconds
    callback: (error, res, done) => {
        if (error) {
            console.error("Fetch Error:", error);
            done();
            return;
        }

        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            console.log(`Skipping non-HTML content at ${res.request.uri.href}`); // decided to skip non-html since its simpler this way
            done();
            return;
        }

        const $ = res.$;
        const currentURL = res.request.uri.href;

        if (crawledURLs.has(currentURL) || disallowedUrls.includes(currentURL)) {
            done();
            return;
        }

        // Determine which site we're on and use the appropriate table
        const isFruitSite = currentURL.includes('fruitgraph');
        const currentCrawlCount = isFruitSite ? fruitCrawlCount : personalCrawlCount;
        const pageTitle = $('title').text();
        
        if (currentCrawlCount.count >= maxCrawlCount) {
            console.log(`Max crawl limit reached for ${isFruitSite ? 'fruit' : 'personal'} site. Skipping ${currentURL}`); // when we reach 1000
            if (!isFruitSite){
                return;
            }
            done();
            return;
        }

        crawledURLs.add(currentURL);
        currentCrawlCount.count++;

        const pageTable = isFruitSite ? 'pages_fruits' : 'pages_personal';
        const linkTable = isFruitSite ? 'links_fruits' : 'links_personal';

        // Store page content to database
        db.run(`INSERT OR IGNORE INTO ${pageTable} (url, content, title) VALUES (?, ?, ?)`, [currentURL, $('body').html(), pageTitle], function(err) {
            if (err) {
                console.error(`Error inserting into ${pageTable}:`, err);
            } else {
                console.log("Inserted page:", currentURL);
            }
        });
        

        const links = $("a"); //

        links.each(function() {
            const relativeUrl = $(this).attr('href');
            if (typeof relativeUrl === 'string') { // Check if relativeUrl is a string
                const absoluteUrl = urlModule.resolve(currentURL, relativeUrl);
        
                db.run(`INSERT OR IGNORE INTO ${linkTable} (source_url, dest_url) VALUES (?, ?)`, [currentURL, absoluteUrl], checkError);
        
                if (!crawledURLs.has(absoluteUrl)) {
                    crawler.queue(absoluteUrl);
                }
            }
        });
        

        done();
    }
});

let fruitSiteFinished = false;  // Step 1: Add the flag

crawler.on('drain', function() {
    if (!fruitSiteFinished) {
        fruitSiteFinished = true;  // Mark the fruit site as finished
        crawler.queue("https://japan-dev.com/");  // Queue the second website - Commented this out to not get ip banned by them for crawling
        console.log("Crawl Finished!");
    } else {
        console.log("Crawl Finished!");
        db.close();
    }
});

crawler.queue('https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html'); 


