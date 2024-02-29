/**
 * JWLib Linker - Obsidian Plugin
 * =================
 * Reading View: Show bible references as JW Library links.
 * Editing View: Adds Command to convert both bible references and jw.org "finder" links to JW Library links.
 * Works on the current selection or current line.
 * 
 */

var obsidian = require('obsidian');

class JWLibLinker extends obsidian.Plugin {
  constructor() {
    super(...arguments);
  }
  async onload() {

    console.log("JWLib Linker v." + this.manifest.version + " loaded. " + new Date().toTimeString());
    
    // Show jwlib link in Reading Mode (html)
    this.registerMarkdownPostProcessor((element, context) => {
      context.addChild(new Verse(element));
    });

    // Editor command to trigger the conversion on the active line or selection
    this.addCommand({
      id: "convert-to-jwl-link",
      name: Config.CmdName,
      editorCallback: (editor, view) => {
        convertToJWLibLink(editor, view);
      },
    });

    this.registerEvent(
      this.app.workspace.on(
        "editor-menu",
        (menu, editor, view) => {
          menu.addItem((item) => {
            item.setTitle(Config.CmdName)
              .setIcon("external-link")
              .onClick(async () => {
                convertToJWLibLink(editor, view);
              });
          });
        }
      )
    );
  }

  onunload() {}
}

/**
 * In Reading View:
 * Render the verse in the html element as a JW Library links
 */
class Verse extends obsidian.MarkdownRenderChild {
  constructor(containerEl) {
    super(containerEl);
  }

  onload() {
    const {result, changed} = addBibleLinks(this.containerEl.innerHTML, false, eType.URL);
    if (changed) {
      this.containerEl.innerHTML = result;
    }
  }
}

/**
 * In Editing/Preview View:
 * (1) Convert the verse references to a JW Library links 
 * (2) Swap jw.org Finder links to a JW Library links
 * 
 * @param {obsidian.Editor} editor 
 * @param {obsidian.MarkdownView} view
 */
const convertToJWLibLink = (editor, view) => {
  let input;
  let line_no;

  // Either the (1) current selection or the (2) current line
  if (editor.getSelection().length > 0) {
    input = editor.getSelection();
  } else {
    line_no = editor.getCursor().line
    input = editor.getLine(line_no);
  }
  input = input ?? "";
  
  let {result, changed} = swapFinderLinks(input, false);
  ({result, changed} = addBibleLinks(result, changed, eType.MD));

  if (changed) {
    if (line_no !== undefined) {
      editor.setLine(line_no, result);
    } else {
      editor.replaceSelection(result);
    }
  }
}

/**
 * Replaces all verse references in input text with JW Library bible links
 * 
 * @param {string} input
 * @param {boolean} changed
 * @param {eType} type
 * @return {string, boolean}
 */
const addBibleLinks = (input, changed, type) => {
  let match;
  let verse_markup;
  let result = input;

  while ((match = Config.Regex.exec(input) ) !== null) {
    if (match[M.IsLink] === undefined) {
      // Add the book ordinal if it exists
      // The abbr. list has no spaces: e.g. 1kings 1ki matthew matt mt
      // The (^| ) forces a "Starting with" search to avoid matching inside book names, e.g. eph in zepheniah
      let book = new RegExp("(^| )" + (match[M.Ordinal] ?? "").trim() + match[M.Book].replace(".", "").toLowerCase(), "m");
      let book_match = Bible.Abbreviation.findIndex(elem => elem.search(book) !== -1);
      if (book_match !== -1) {
        let book_no = book_match + 1;
        let chp_no = match[M.Chapter];
        let verse_no = match[M.Verse];
        let verses = verse_no + (match[M.Verses] ?? "");

        // Rebuild a full canonical bible verse reference
        let display = Bible.Book[book_no - 1] + ' ' + chp_no + ':' + verses;

        // Format: 01001006 = Book 01 Chapter 002 Verse 006 = Genesis 2:6
        let verse_ref = book_no.toString().padStart(2, "0") + chp_no.padStart(3, "0") + verse_no.padStart(3, "0");
        let href = `${Config.JWLFinder}${Config.Param}${verse_ref}`;
        if (type === eType.URL) {
          verse_markup = `<a href="${href}" title="${href}">${display}</a>`;  // make the target visible on hover
        } else if (type === eType.MD) {
          verse_markup = `[${display}](${href})`
        }
        result = result.replace(match[M.Reference], verse_markup);
        changed = true;
      }
    }
  }
  return {result, changed};
}

/**
 * Replaces all JW Web Finder links in input text with JW Library Finder links
 * 
 * @param {string} input
 * @param {boolean} changed
 * @return {string, boolean}
 */
const swapFinderLinks = (input, changed) => {
  let result = input
  if (input.includes(Config.WebFinder)) {
    result = input.replace(Config.WebFinder, Config.JWLFinder);
    changed = true;
  }
  return {result, changed};
}

const Config = {
  JWLFinder: "jwlibrary:///finder?",
  Param    : "bible=",
  WebFinder: "https://www.jw.org/finder?",
  Regex    : /(([123] ?)?([\p{L}\p{M}\.]{2,}|song of solomon) ?(\d{1,3}):(\d{1,3})([-,] ?\d{1,3})?)(\]|<\/a>)?/gmiu, // https://regexr.com/7smfh
  CmdName  : "Convert to JWL link",
}

// Match group numbers
const M = {
  Reference: 1,   // full canonical verse reference, proper case, spaced
  Ordinal  : 2,   // book ordinal (1, 2, 3) | undefined ?? *remember to Trim!
  Book     : 3,   // book name (recognises fullstops & Unicode accented letters: ready for other languages)
  Chapter  : 4,   // chapter no.
  Verse    : 5,   // verse no.
  Verses   : 6,   // any additional verses (-3, ,12 etc) | undefined ??
  IsLink   : 7,   // matches following ] or >. Match => this is already a Wiki or URL link
}

const eType = {
  URL: "URL",  // HTML href link <a>...</a>
  MD : "MD",     // Markdown link [](...)
}

const Bible = {
  Book: [
    "Genesis",
    "Exodus",
    "Leviticus",
    "Numbers",
    "Deuteronomy",
    "Joshua",
    "Judges",
    "Ruth",
    "1 Samuel",
    "2 Samuel",
    "1 Kings",
    "2 Kings",
    "1 Chronicles",
    "2 Chronicles",
    "Ezra",
    "Nehemiah",
    "Esther",
    "Job",
    "Psalms",
    "Proverbs",
    "Ecclesiastes",
    "Song of Solomon",
    "Isaiah",
    "Jeremiah",
    "Lamentations",
    "Ezekiel",
    "Daniel",
    "Hosea",
    "Joel",
    "Amos",
    "Obadiah",
    "Jonah",
    "Micah",
    "Nahum",
    "Habakkuk",
    "Zephaniah",
    "Haggai",
    "Zechariah",
    "Malachi",
    "Matthew",
    "Mark",
    "Luke",
    "John",
    "Acts",
    "Romans",
    "1 Corinthians",
    "2 Corinthians",
    "Galatians",
    "Ephesians",
    "Philippians",
    "Colossians",
    "1 Thessalonians",
    "2 Thessalonians",
    "1 Timothy",
    "2 Timothy",
    "Titus",
    "Philemon",
    "Hebrews",
    "James",
    "1 Peter",
    "2 Peter",
    "1 John",
    "2 John",
    "3 John",
    "Jude",
    "Revelation",
  ],

  Abbreviation: [
    "genesis ge gen",
    "exodus ex exod",
    "leviticus le lev",
    "numbers nu num",
    "deuteronomy de deut",
    "joshua jos josh",
    "judges jg judg",
    "ruth ru",
    "1samuel 1sa 1sam",
    "2samuel 2sa 2sam",
    "1kings 1ki 1kg",
    "2kings 2ki 2kg",
    "1chronicles 1ch 1chr",
    "2chronicles 2ch 2chr",
    "ezra ezr",
    "nehemiah ne nem",
    "esther es est",
    "job jb",
    "psalms ps psa",
    "proverbs pr pro prov",
    "ecclesiastes ec ecc eccl",
    "song of solomon canticles ca sos sng song",
    "isaiah isa",
    "jeremiah jer",
    "lamentations la lam",
    "ezekiel eze",
    "daniel da dan",
    "hosea ho hos",
    "joel joe joel",
    "amos am amo amos",
    "obadiah ob oba",
    "jonah jon",
    "micah mic",
    "nahum na nah",
    "habakkuk hab",
    "zephaniah zep zeph",
    "haggai hag",
    "zechariah zec zech",
    "malachi mal",
    "matthew mt mat matt",
    "mark mr mk mark",
    "luke lu luke",
    "john joh john",
    "acts ac act",
    "romans ro rom",
    "1corinthians 1co 1cor",
    "2corinthians 2co 2cor",
    "galatians ga gal",
    "ephesians eph",
    "philippians php",
    "colossians col",
    "1thessalonians 1th",
    "2thessalonians 2th",
    "1timothy 1ti 1tim",
    "2timothy 2ti 2tim",
    "titus ti tit",
    "philemon phm",
    "hebrews heb",
    "james jas",
    "1peter 1pe 1pet",
    "2peter 2pe 2pet",
    "1john 1jo 1joh",
    "2john 2jo 2joh",
    "3john 3jo 3joh",
    "jude jud jude",
    "revelation re rev"
  ]
}

module.exports = {
  default: JWLibLinker,
}