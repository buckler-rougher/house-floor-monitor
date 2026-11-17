// @cloudflare/puppeteer imports node:fs to write screenshots and PDFs to a file path. The Workers runtime has no node:fs at this Worker's compatibility date (2023-12-01), and Cloudflare
// rejects the upload ("No such module node:fs", code 10021). handleOgImage takes the screenshot as bytes and never passes a path, so nothing here is called; if something ever does, it says so.
// Wired in by [alias] in wrangler.toml.
const no = (name) => () => { throw new Error(`node:fs ${name} is not available in a Worker`); };
const promises = { readFile: no('promises.readFile'), writeFile: no('promises.writeFile'), open: no('promises.open'), mkdir: no('promises.mkdir'), access: no('promises.access'), stat: no('promises.stat'), mkdtemp: no('promises.mkdtemp'), rm: no('promises.rm') };
const fs = { promises, readFileSync: no('readFileSync'), writeFileSync: no('writeFileSync'), existsSync: () => false, mkdirSync: no('mkdirSync'), createWriteStream: no('createWriteStream'), createReadStream: no('createReadStream') };
export { promises };
export default fs;
