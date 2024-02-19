/*
JW Library Verse Link - Obsidian Plugin
===============
Looks for valid NWT Bible verse references in the Markdown text and
automatically displays them as working local JW Library hyperlinks in the Reading View.
*/

var obsidian = require('obsidian');

class JWLibVerse extends obsidian.Plugin {
  constructor() {
    super(...arguments);
  }
  async onload() {
    this.registerMarkdownPostProcessor(( element, context ) => {
      context.addChild( new Verse( element ) );
    });
  }

  onunload() {}
}


class Verse extends obsidian.MarkdownRenderChild {
  constructor( containerEl ) {
    super( containerEl );
  }

  onload() {
    let match;
    let raw = this.containerEl.innerHTML;
    let result = raw;
    while ( ( match = Link.Regex.exec( raw ) ) !== null ) {
      // console.log( match );
      let book = ( match[1] ?? "" ) + match[2]; // add the book ordinal if it exists
      // Use a "Starting with" search only, to avoid match inside book names, e.g. eph in zepheniah
      let book_match = Bible.Abbreviation.find( elem => elem.search( " " + book.toLowerCase() ) !== -1 );
      if ( book_match !== undefined ) {
          let book_no = Number( book_match.substring(0, 2) );
          let chp_no = match[3];
          let verse_no = match[4];
          let verses = verse_no + ( match[5] ?? "" );
          // Rebuild a full canonical bible verse reference
          let display = Bible.Book[ book_no - 1 ] + ' ' + chp_no + ':' + verses;
          let verse_ref = book_no.toString().padStart(2, "0") + chp_no.padStart(3, "0") + verse_no.padStart(3, "0");
          let href = `${Link.Prefix}${verse_ref}`;
          let verse_url = `<a href="${href}" title="${href}">${display}</a>`;  // make the target visible on hover
          result = result.replace( match[0], verse_url );
          this.containerEl.innerHTML = result;
      }
    };
  }
}

const Link = {
  // Format: E.g. Gen 1:6 => https://wol.jw.org/en/wol/b/r1/lp-e/nwtsty/1/1#study=discover&v=1:1:6
  Prefix: "jwlibrary:///finder?bible=",
  // 0 = original, 1 = book no. (could be undefined), 2 = book name, 3 = chapter, 4 = verse
  Regex: /([123])?(?:\s|&nbsp;)?([A-Z][a-zA-Z]+|Song of Solomon)\.?\s?(1?[0-9]?[0-9]):(\d{1,3})([,-]\s?\d{1,3})*/gmi,
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
  default: JWLibVerse,
}
