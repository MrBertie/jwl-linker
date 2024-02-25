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

    console.log("JW Library Verse Link v." + this.manifest.version + " loaded. " + new Date().toString());
    
    // Show jwlib link in Reading Mode (html)
    this.registerMarkdownPostProcessor((element, context) => {
      context.addChild(new Verse(element));
    });

    // Editor command to trigger the conversion on the active line or selection
    this.addCommand({
      id: "preview-verse",
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
    ({result, changed} = addVerseLinks(this.containerEl.innerHTML, false, eType.URL));
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

  let changed = false;
  let result = input;
  ({result, changed} = swapFinderLinks(result, changed));
  ({result, changed} = addVerseLinks(result, changed, eType.Wiki));
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
const addVerseLinks = (input, changed, type) => {
  let match;
  let verse_markup;
  let result = input;

  while ((match = Config.Regex.exec(input) ) !== null) {
    if (match[M.IsLink] === undefined) {
      let book = (match[M.Ordinal] ?? "") + match[M.Book]; // add the book ordinal if it exists

      // Use a "Starting with" search only, to avoid match inside book names, e.g. eph in zepheniah
      let book_match = Bible.Abbreviation.find( elem => elem.search(" " + book.toLowerCase()) !== -1);
      if (book_match !== undefined) {
        let book_no = Number(book_match.substring(0, 2));
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
        } else if (type === eType.Wiki) {
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
 * Replaces all Web Finder links in input text with JW Library Finder links
 * 
 * @param {string} input
 * @param {boolean} changed
 * @return {string, boolean}
 */
const swapFinderLinks = (input) => {
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
  Regex    : /(([123])? ?(\w{2,}|song of solomon) (\d{1,3}):(\d{1,3})([-,] ?\d{1,3})?)(\]|<\/a>)?/gmi,
  CmdName  : "Convert to JWL link",
}

// Match group numbers
const M = {
  Reference: 1,   // full canonical verse reference, proper case, spaced
  Ordinal  : 2,   // book ordinal (1, 2, 3) | undefined ??
  Book     : 3,   // book name
  Chapter  : 4,   // chapter no.
  Verse    : 5,   // verse no.
  Verses   : 6,   // any additional verses (-3, ,12 etc) | undefined ??
  IsLink   : 7,   // matches [ or > which means this is already a Wiki or URL link
}

const eType = {
  URL : "URL",
  Wiki: "Wiki",
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
    "01 genesis ge gen",
    "02 exodus ex exod",
    "03 leviticus le lev",
    "04 numbers nu num",
    "05 deuteronomy de deut",
    "06 joshua jos josh",
    "07 judges jg judg",
    "08 ruth ru",
    "09 1samuel 1sa 1sam",
    "10 2samuel 2sa 2sam",
    "11 1kings 1ki 1kg",
    "12 2kings 2ki 2kg",
    "13 1chronicles 1ch 1chr",
    "14 2chronicles 2ch 2chr",
    "15 ezra ezr",
    "16 nehemiah ne nem",
    "17 esther es est",
    "18 job jb",
    "19 psalms ps psa",
    "20 proverbs pr pro prov",
    "21 ecclesiastes ec ecc eccl",
    "22 song of solomon canticles ca sos sng song",
    "23 isaiah isa",
    "24 jeremiah jer",
    "25 lamentations la lam",
    "26 ezekiel eze",
    "27 daniel da dan",
    "28 hosea ho hos",
    "29 joel joe joel",
    "30 amos am amo amos",
    "31 obadiah ob oba",
    "32 jonah jon",
    "33 micah mic",
    "34 nahum na nah",
    "35 habakkuk hab",
    "36 zephaniah zep zeph",
    "37 haggai hag",
    "38 zechariah zec zech",
    "39 malachi mal",
    "40 matthew mt mat matt",
    "41 mark mr mk mark",
    "42 luke lu luke",
    "43 john joh john",
    "44 acts ac act",
    "45 romans ro rom",
    "46 1corinthians 1co 1cor",
    "47 2corinthians 2co 2cor",
    "48 galatians ga gal",
    "49 ephesians eph",
    "50 philippians php",
    "51 colossians col",
    "52 1thessalonians 1th",
    "53 2thessalonians 2th",
    "54 1timothy 1ti 1tim",
    "55 2timothy 2ti 2tim",
    "56 titus ti tit",
    "57 philemon phm",
    "58 hebrews heb",
    "59 james jas",
    "60 1peter 1pe 1pet",
    "61 2peter 2pe 2pet",
    "62 1john 1jo 1joh",
    "63 2john 2jo 2joh",
    "64 3john 3jo 3joh",
    "65 jude jud jude",
    "66 revelation re rev"
  ]
}

module.exports = {
  default: JWLibLinker,
}
