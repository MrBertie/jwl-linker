/**
 * JWL Linker - Obsidian Plugin
 * =================
 * Reading View: Show scriptures references as JW Library links.
 * Editing View: Adds Command to convert both scripture references and jw.org finder links to JW Library links.
 * Works on the current selection or current line.
 *
 */

const { Plugin, Editor, MarkdownView, Menu, Notice, 
  MarkdownRenderChild, requestUrl, Setting, PluginSettingTab } = require('obsidian');

const DEFAULT_SETTINGS = {
  scriptureTemplate: '> [!verse] BIBLE — {title}\n> {text}\n',
  paragraphTemplate: '> [!cite] PAR. — {title}\n> {text}\n',
  snippetTemplate: '{title}\u2002“*{text}…*”',
  snippetLength: 20,
  boldVerseNo: true,
  citationLink: true,
  lang: 'English',
};

// Keep separate from ResultError to allow future i18n
const Lang = {
  name: 'JWL Linker',
  invalidScripture: '⚠️ The reference is not a valid scripture reference.',
  invalidUrl: '⚠️ The reference is not a valid wol.jw.org url.',
  onlineLookupFailed: '⚠️ Online scripture lookup failed. Try again.',
  loadingCitation: '⏳ Loading citation:',
  noEditor: '⚠️ No active editor available.',
  noSelection: '⚠️ Nothing on cursor line or no selection.',
};

const Languages = {
  English: 'EN',
  German: 'DE',
  Dutch: 'NL',
  French: 'FR',
};

const Config = {
  jwlFinder: 'jwlibrary:///finder?',
  wolRoot: 'https://wol.jw.org',
  webFinder: 'https://www.jw.org/finder?',
  urlRegex: /https\:\/\/[^\s)]+/gmi,
  urlParam: 'bible=',
  scriptureRegex:
    /(('?)([123][\u0020\u00A0]?)?([\p{L}\p{M}\.]{2,}|song of solomon) ?(\d{1,3}):(\d{1,3})([-,] ?\d{1,3})?)(\]|<\/a>)?/gimu, // https://regexr.com/7smfh
  wolLinkRegex: /(\[([^\[\]]*)\]\()?(https\:\/\/wol\.jw\.org[^\s\)]{2,})(\))?/gmi,
  delay: 3000,
};

class JWLLinkerPlugin extends Plugin {
  /** @type {Object} */
  settings;
  /** @type {Menu} */
  menu;

  constructor() {
    super(...arguments);

    /** @namespace */
    this.api = {
      validateScripture: Lib.validateScripture,
      matchPotentialScriptures: Lib.matchPotentialScriptures,
      DisplayType: DisplayType,
    };
    this.menuClass = 'jwl-linker-plugin-menu-container';
  }

  async onload() {
    await this.loadSettings();

    // Reading Mode: Render scriptures as JWLibrary links
    this.registerMarkdownPostProcessor((element, context) => {
      context.addChild(new ScripturePostProcessor(element));
    });

    // Load command palette
    Object.entries(this.menuItems).forEach(([id, cmd]) => {
      this.addCommand({
        id: id,
        name: cmd.text,
        icon: cmd.icon,
        editorCallback: cmd.fn,
      });
    });
    
    // Cache the populated menu
    this.menu = this.buildMenu();
    
    // Add the global Open Menu command
    this.addCommand({
      id: this.menuName.id,
      name: this.menuName.text,
      icon: this.menuName.icon,
      editorCallback: (editor) => this.showMenu(editor),
    });
    
    // Add right-click item in Editor to show the Menu
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        menu.addItem((item) => {
          item
          .setTitle(this.menuName.text)
          .setIcon(this.menuName.icon);
          // .onClick(async () => this.showMenu(editor));
          const submenu = item.setSubmenu();
          this.buildMenu(submenu);
        });
      })
    );
    
    this.addSettingTab(new JWLLinkerSettingTab(this.app, this));

    console.log('%c' + this.manifest.name + ' ' + this.manifest.version +
    ' loaded', 'background-color: purple; padding:4px; border-radius:4px');

  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /*================*/

  /**
   * Show the dropdown menu just below the caret
   * @param {Editor} editor 
   * @param {Menu} menu 
   * @returns {void}
   */
  showMenu(editor) {
    // Is the menu already active?
    if (document.querySelector('.menu.' + this.menuClass)) return;
    
    if (!editor || !editor.hasFocus()) {
      new Notice(Lang.noEditor, Config.delay);
      return;
    }
    const cursor = editor.getCursor("from");
    const offset = editor.posToOffset(cursor);
    const coords = editor.cm.coordsAtPos(offset);
    this.menu.showAtPosition({
      x: coords.right,
      y: coords.top + 20,
    });
  }

  /**
   * Checks if there is an active editor, and attempts to return it
   * @param {Editor} editor 
   * @returns {Editor}
   */
  confirmEditor(editor) {
    if (!editor || !editor.hasFocus()) {
      const view = this.app.workspace.getMostRecentLeaf().view;
      if (view) {
        editor = view.editor;
      }
    }
    if (!editor) {
      new Notice(Lang.noEditor, Config.delay);
    }
    return editor;
  }

  /**
    * Editing/Preview View only
    * Convert to JW Library links, 
    * Applies to the entire input string, works on either:
    *   target: jw.org Finder links
    *   target: plain text scripture references
    * Both are validated
    * @param {Editor} editor
    * @param {MarkdownView} view
    */
  switchToLibraryLinks(editor, target) {
    editor = this.confirmEditor(editor);
    if (!editor) return;
    let { selection } = Lib.getEditorSelection(editor);
    if (selection) {
      let result, changed, error;
      if (target == TargetType.scripture) {
        ({ result, changed, error } = Lib.addBibleLinks(selection, DisplayType.md));
      } else if (target === TargetType.jwonline) {
        ({ result, changed, error } = Lib.convertToLibraryUrls(selection));
      }
      if (error !== ResultError.none) {
        new Notice(Lang[error], Config.delay);
      } else if (changed) {
        editor.replaceSelection(result);
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }
  }

  /**
   * Editing/Preview View only:
   * Cite scripture reference in full or just a snippet, adds a JWL link
   * Cite paragraph or snippet from JW.Org Finder or WOL url, 
   *    with correct publication navigation title
   * Add title only: an MD link with correct navigation title + url
   * @param {Editor} editor
   * @param {MarkdownView} view
   * @param {CiteType} type
   */
  insertCitation(editor, type) {
    /** @type {Notice} */
    let loadingNotice;
    editor = this.confirmEditor(editor);
    if (!editor) return;
    let { selection, caret } = Lib.getEditorSelection(editor, true);
    if (selection) {
      selection = selection.trim();
      loadingNotice = new Notice(Lang.loadingCitation + ' ' + selection); // remain open until we complete
      const is_scripture = (type == CiteType.scriptureEntire || type == CiteType.scriptureSnippet);
      if (is_scripture) {
        // Convert Scripture reference into bible verse citation (+ JW Library MD URL*)
        Lib.addBibleCitation(selection, caret, this.settings, type).then(handleCitation);
      } else {
        // Convert JW.Org Finder-type URL to a paragraph citation (+ JW Library MD URL*)
        Lib.addParagraphCitation(selection, caret, this.settings, type).then(handleCitation);
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }

    function handleCitation({ result, changed, error }) {
      if (error !== ResultError.none) {
        loadingNotice.hide();
        new Notice(Lang[error], Config.delay);
      } else if (changed) {
        editor.replaceSelection(result);
        loadingNotice.hide();
      }
    };
  }

  // Prepare the dropdown menu
  // Each menu item calls its command counterpart
  buildMenu(submenu = undefined) {
    /** @type {Menu} */
    const menu = submenu ? submenu : new Menu();
    // this class is needed to identify if the menu is already open
    menu.dom.addClass(this.menuClass);
    // no title on submenus
    if (!submenu) {
      menu.addItem(item => {
        item.setTitle(this.menuName.title);
        item.setIcon(this.menuName.icon);
        item.setIsLabel(true);
      });
      menu.addSeparator();
    }
    Object.entries(this.menuItems).forEach(([id, cmd]) => {
      menu.addItem(item => {
        item.setTitle(cmd.text);
        item.setIcon(cmd.icon);
        item.onClick(() => this.app.commands.executeCommandById(this.manifest.id + ':' + id));
      });
      if (cmd.sep ?? null) menu.addSeparator();
    });
    return menu;
  }

  menuName = { 
    id: 'openJWLLinkerMenu', 
    text: 'JWL Linker',
    title: 'JWL Linker',
    icon: 'gem',
  };

  menuItems = {
    convertScriptureToLibrary: { 
      text: 'Link scriptures to JWLibrary', 
      icon: 'library',
      fn: (editor) => this.switchToLibraryLinks(editor, TargetType.scripture),
    },
    switchWebToLibrary: { 
      text: 'Switch web link to JWLibrary', 
      icon: 'library',
      fn: (editor) => this.switchToLibraryLinks(editor, TargetType.jwonline),
      sep: true,
    },
    citeScripture: { 
      text: 'Cite scripture in full', 
      icon: 'book-open', 
      fn:  (editor) => this.insertCitation(editor, CiteType.scriptureEntire),
    },
    citeScriptureSnippet: { 
      text: 'Cite scripture snippet', 
      icon: 'whole-word', 
      fn:  (editor) => this.insertCitation(editor, CiteType.scriptureSnippet),
      sep: true,
    },
    citeParagraph: { 
      text: 'Cite paragraph from link', 
      icon: 'pilcrow', 
      fn: (editor) => this.insertCitation(editor, CiteType.wolEntire),
    },
    citeSnippet: { 
      text: 'Cite snippet from link', 
      icon: 'whole-word', 
      fn: (editor) => this.insertCitation(editor, CiteType.wolSnippet), 
    },
    addLinkTitle: { 
      text: 'Add title to link', 
      icon: 'link', 
      fn: (editor) => this.insertCitation(editor, CiteType.wolTitle),
    },
  };
}

/**
 * Reading View only:
 * Render all Scripture references in this HTML element as a JW Library links instead
 */
class ScripturePostProcessor extends MarkdownRenderChild {
  constructor(containerEl) {
    super(containerEl);
  }

  onload() {
    const { result, changed } = Lib.addBibleLinks(
      this.containerEl.innerHTML,
      DisplayType.url
    );
    if (changed) {
      this.containerEl.innerHTML = result;
    }
  }
}

class Lib {

  /**
   * In the active editor:
   * (1) the current selection if available, defaults to current line
   * (2) sets selection to current line and returns it
   * Assumes an editor is active!
   * @param {Editor} editor
   * @param {boolean} getLine select and return entire line
   * @returns {{ string, number }} current selection and relative caret position
   */
  static getEditorSelection(editor, getLine = false) {
    let selection, caret;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    // either the (1) current selection
    if (!getLine && editor.somethingSelected()) {
      selection = editor.getSelection();
      caret = cursor.ch + line.indexOf(selection);
    // or the (2) current line (select whole line)
    } else {
      editor.setSelection({ line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
      selection = editor.getSelection();
      caret = cursor.ch;
    }
    return { selection, caret };
  }

  /**
   * Swaps all jw.org Finder-style and wol.jw.org urls in input text for JW Library app urls
   * @param {string} input
   * @return {{result: string, changed: boolean}} Updated text with swapped links, changed is true if at least one url changed
   */
  static convertToLibraryUrls(input) {
    let result = input;
    let changed = false;
    // first find all possible web urls
    const urls = input.matchAll(Config.urlRegex);
    for (const match of urls) {
      const url = match[0];
      // Handle wol.jw.org links first
      if (url.startsWith(Config.wolRoot)) {
        const { doc_id, par_id } = Lib.getWOLParams(url);
        result = result
          .replace(url, Config.jwlFinder + '&docid=' + doc_id + '&par=' + par_id);
        changed = true;
      // and now jw.org Finder links, usually already have a par id
      } else {
        result = result
          .replace(Config.webFinder, Config.jwlFinder);
        changed = true;
      }
    }
    return { result, changed, error: ResultError.none };
  }

  /**
   * Replaces all valid scripture references in input text with JW Library MD links []()
   * @param {string} input
   * @param {boolean} changed
   * @param {DisplayType} type
   * @return {{result: string, changed: boolean, error: ResultError}}
   */
  static addBibleLinks(input, type) {
    /** @type {TMatch} */
    let match;
    let markup;
    let result = input;
    let changed = false;
    let error = ResultError.none;

    // Only accept text elements for now
    // TODO: 🚧 resolve references in headings and callouts, breaks formatting...
    const is_text_elem = !(input.startsWith('<h') || input.startsWith('<div data'));

    if (is_text_elem) {
      for (match of Lib.matchPotentialScriptures(input)) {
        // Look for forced plain text
        if (match.plain) {
          type = DisplayType.plain;
        }
        if (!match.isLink) {
          let { display, jwlib } = this.validateScripture(match, type);
          if (display) {  // Is the scripture reference valid?
            if (type === DisplayType.plain) {
              markup = display;
            } else if (type === DisplayType.md) {
              markup = `[${display}](${jwlib})`;
            } else if (type === DisplayType.url) {
              markup = `<a href="${jwlib}" title="${jwlib}">${display}</a>`; // make the target URL visible on hover
            }
            result = result.replace(match.reference, markup);
            changed = true;
          } else {
            error = ResultError.invalidScripture;
          }
        }
      }
    }
    return { result, changed, error };
  }

  /**
   * Replaces scripture reference with a sanitized, formatted bible citation
   * from jw.org html page, could include a jwlib link (see settings.citationLink)
   * @param {string} input Text containing the scripture
   * @param {number} caret Current caret position in the input
   * @param {Object} settings plugin.settings
   * @param {CiteType} type
   * @returns {{result: string, changed: boolean, error: ResultError}}
   */
  static async addBibleCitation(input, caret, settings, type) {
    /** @type {TMatch|null} */
    const match = this.matchPotentialScriptures(input, caret)[0] ?? null; // match at the caret only
    if (match) {
      let { display, jwlib, jworg, scripture_ids } = this.validateScripture(
        match,
        DisplayType.cite
      );

      // Is the reference valid?
      if (display === '') {
        return { result: input, changed: false, error: ResultError.invalidScripture };
      }

      let title = display;
      if (settings.citationLink) {
        title = `[${display}](${jwlib})`;
      }
      
      try {
        const res = await requestUrl(jworg);
        if (res.status === 200) {
          let lines = [];
          let clean = '';
          let glue = '';
          let template;
          const num_rgx = /^(\d{1,3}) /;
          const source = res.text;
          const dom = new DOMParser().parseFromString(source, 'text/html');
          scripture_ids.forEach((id) => {
            let elem = dom.querySelector('#v' + id);
            if (elem) {
              clean = this.extractPlainText(elem.innerHTML, TargetType.scripture);
              // Check for initial chapter numbers
              if (elem.querySelector('.chapterNum')) {
                clean = clean.replace(num_rgx, '1 ');
              // Allow for block or inline verse styling
              // Prepend a space/newline, except first block
              } else if (lines.length > 0) {
                const add_newline =
                  elem.firstChild.hasClass('style-l') || elem.firstChild.hasClass('newblock');
                glue = add_newline ? '\n' : ' ';
              }
              // make verse number bold, e.g. **4**
              if (settings.boldVerseNo) {
                clean = clean.replace(num_rgx, '**$1** ');
              }
              lines.push(glue + clean);
            }
          });
          let text = lines.join('');
          if (type == CiteType.scriptureSnippet) {
            text = this.firstXWords(text, settings.snippetWords);
            template = settings.snippetTemplate;
          } else if (type = CiteType.scriptureEntire) {
            template = settings.scriptureTemplate;
          }
          const citation = template
            .replace('{title}', title)
            .replace('{text}', text);
          const result = input.replace(match.reference, citation);
          return { result: result, changed: true, error: ResultError.none };
        }
      } catch (error) {
        console.log(error);
      }
    }
    // default return
    return { result: input, changed: false, error: ResultError.onlineLookupFailed };
  }

  /**
   * Replaces a wol.jw.org url with a sanitized, formatted paragraph citation
   * Must be the last thing on the line (to allow space for the new citation)
   * @param {string} input text containing a wol.jw.org URL
   * @param {number} caret position of the caret in the input
   * @param {Object} settings plugin.settings
   * @param {CiteType} citeType paragraph, snippet or title
   * @returns {{result: string, changed: boolean, error: ResultError}}
   */
  static async addParagraphCitation(input, caret, settings, citeType) {
    let citation = '';

    // The url must be the last thing on the line
    // Store anything before it like bullets or other text, to be added later.
    // 🔥Only wol.jw.org links!
    const { whole, title, url } = this.linkFromCaret(input, caret);
    if (!URL.canParse(url)) {
      return { result: input, changed: false, error: ResultError.invalidUrl };
    }

    try {
      const res = await requestUrl(url);
      if (res.status === 200) {
        const source = res.text;
        const dom = new DOMParser().parseFromString(source, 'text/html');
        // title: html title, navigation: the jw citation location
        const page_title = this.extractPlainText(
          dom.querySelector('title').innerHTML,
          TargetType.jwonline
        );
        let page_nav = this.extractPlainText(
          dom.querySelector('#publicationNavigation').innerHTML,
          TargetType.pubNav
        );
        let text = '';
        if (citeType !== CiteType.wolTitle) {
          // Look for a wol paragraph #ID
          const { par_id } = this.getWOLParams(url);
          if (par_id) {
            text = this.extractPlainText(dom.querySelector('#p' + par_id).innerHTML);
          }
        }
        let result = '';
        if (page_title) {
          const display = page_nav !== '' ? page_nav : page_title;
          const link = `[${display}](${url})`;
          if (citeType == CiteType.wolTitle) {
            citation = link;
          } else {
            let template;
            if (citeType == CiteType.wolSnippet) {
              template = settings.snippetTemplate;
              text = this.firstXWords(text, settings.snippetLength);
            } else if (citeType == CiteType.wolEntire) {
              template = settings.paragraphTemplate;
              // make verse number bold, e.g. **4**
              if ((settings.boldVerseNo)) {
                text = text.replace(/^(\d{1,3}) /, '**$1** ');
              }
            }
            citation = template
              .replace('{title}', link)
              .replace('{text}', text);
          }
          result = input.replace(whole, citation);
          return { result: result, changed: true, error: ResultError.none };
        }
      }
    } catch (error) {
      console.log(error);
    }
    // default return
    return { result: input, changed: false, error: ResultError.onlineLookupFailed };
  }

  /**
   * Looks for wol links in the input text
   * Return the link nearest to the caret position, or empty string
   * @param {string} input 
   * @param {number} caret 
   * @returns {{ whole: string, title: string, url: string }}
   */
  static linkFromCaret(input, caret) {
    let whole = '', title = '', url = '';
    const matches = input.matchAll(Config.wolLinkRegex);
    for (const match of matches) {
      const begin = match.index;
      const end = begin + match[0].length;
      if (caret >= begin && caret <= end) {
        whole = match[0];
        title = match[1] ? match[2] : '';
        url = match[3];
        break;
      }
    }
    return { whole, title, url };
  }

  /**
   * Extracts the document and paragraph id from a WOL url
   * @param {string} url WOL url
   * @returns {{string, string}} WOL url document id and paragraph number id
   */
  static getWOLParams(url) {
    let doc_id, par_id = '';
    const id = url.split('/').slice(-1)[0];
    if (id.includes('#h')) {
      ([ doc_id, par_id ] = id.split('#h=', 2));
    } else {
      doc_id = id;
    }
    return { doc_id, par_id };
  }

  /** TMatch type Definition
   * The standard Scripture reference match return type
   * @typedef {Object} TMatch ({
   * @property {string} reference,
   * @property {boolean} plain,
   * @property {string} ordinal,
   * @property {string} book,
   * @property {string} chapter,
   * @property {string} verse,
   * @property {string} verses,
   * @property {boolean} isLink,
   * @property {number} begin,
   * @property {number} end,
   */

  /**
   * Try to match and return potential scripture references in the input string
   * If caret is provided then match the nearest scripture only
   * @param {string} input
   * @param {number} caret 
   * @returns {array<TMatch>} Array list of scripture matches
   */
  static matchPotentialScriptures(input, caret = undefined) {
    /** @type array<TMatch> */
    let results = [];
    const matches = input.matchAll(Config.scriptureRegex);
    for (const match of matches) {
      /** @type {TMatch} */
      let result = {
        reference: match[1], // full matched scripture reference
        plain: Boolean(match[2]), // ' => skip this verse, no link
        ordinal: match[3] ?? '', // book ordinal (1, 2, 3) | Empty ?? *remember to Trim!
        book: match[4], // book name (recognises fullstops & Unicode accented letters: ready for other languages)
        chapter: match[5], // chapter no.
        verse: match[6], // verse no.
        verses: match[7] ?? '', // any additional verses (-3, ,12 etc) | Empty ??
        isLink: Boolean(match[8]), // ] or </a> at end => this is already a Wiki/URL link | ' before the verse to skip auto-linking
        begin: match.index,
        end: match.index + match[1].length,
      };
      // try the scripture nearest the caret position
      if (caret >= 0) {
        if (caret >= result.begin && caret <= result.end) {
          results.push(result);
          break;
        }
      } else {
        results.push(result);
      }
    }
    return results;
  }

  /**
   * Process a scripture reference in the text and return:
   * 1. The valid, canonical display version (ps 5:10 => Psalms 5:10)
   * 2. The correct jw scripture ID for the url args
   * 3. An array of scripture IDs (one for each verse in a range)
   *    needed to fetch the verse citations [optional]
   * @param {TMatch} match Scripture regex matches
   * @param {DisplayType} type DisplayType
   * @param {string} lang Current language code (EN DE FR etc)
   * @returns {{display: string, jwlib: string, jworg: string, scripture_ids: array}}
   */
  static validateScripture(match, type) {
    let display = '';
    let jwlib = '';
    let jworg = '';
    let scripture_ids = [];
    const lang = Languages[DEFAULT_SETTINGS.lang]; // No user setting available for this yet

    // First extract the display name
    // ******************************
    // Add the book ordinal if it exists
    // The abbreviation list has no spaces: e.g. 1kings 1ki matthew matt mt
    // The (^| ) forces a "Starting with" search to avoid matching inside book names, e.g. eph in zepheniah
    let book = new RegExp(
      '(^| )' + match.ordinal.trim() + match.book.replace('.', '').toLowerCase(),
      'm'
    );
    let book_match = Bible[lang].Abbreviation.findIndex((elem) => elem.search(book) !== -1);

    // is this a valid bible book?
    if (book_match !== -1) {
      let book_no = book_match + 1;
      let chap_no = match.chapter;
      let verse_no = match.verse;
      let verse_range = match.verses;

      let book_chap = Bible[lang].Book[book_no - 1] + ' ' + chap_no;
      
      // Does this chapter and verse number exist in the bible?
      if (book_chap in BibleDimensions && verse_no <= BibleDimensions[book_chap]) {
        // Build a canonical bible scripture reference
        display = book_chap + ':' + verse_no;
        if (type !== DisplayType.first) {
          display += verse_range;
        }

        let book_chp,
          begin,
          end,
          range = '',
          id;

        // Now handle the verse link id
        // ****************************
        if (type !== DisplayType.plain && type !== DisplayType.first) {
          // Format: e.g. Genesis 2:6
          // Book|Chapter|Verse
          //  01 |  002  | 006  = 01001006
          book_chp = book_no.toString().padStart(2, '0') + chap_no.padStart(3, '0');
          begin = Number(verse_no);

          // Is there a range of verses?
          end = verse_range !== '' ? Number(verse_range.substring(1).trim()) : begin;

          // Also accept  adjacent verse after a comma: 1,2 or 14,15, etc
          // Otherwise just the first verse: 1,4 or 22,27
          if (verse_range.startsWith(',') && end !== begin + 1) {
            end = begin;
          }

          if (end > begin) {
            range = '-' + book_chp + end.toString().padStart(3, '0');
          }
          id = book_chp + verse_no.padStart(3, '0') + range;
          jwlib = `${Config.jwlFinder}${Config.urlParam}${id}`;
        }

        // Finally, handle the verse ids used to fetch the citation from jw.org
        // *****************************
        if (type == DisplayType.cite) {
          jworg = `${Config.webFinder}${Config.urlParam}${id}`;
          for (let i = begin; i <= end; i++) {
            scripture_ids.push(book_no + chap_no.padStart(3, '0') + i.toString().padStart(3, '0'));
          }
        }
      }
    }
    return { display, jwlib, jworg, scripture_ids };
  }

  /**
   * Remove markup and jw.org markup from HTML
   * Returns plain text
   * @param {string} html
   * @param {TargetType} type
   * @returns {string}
   */
  static extractPlainText(html, type) {
    const blocks = ['<span class="newblock"></span>', '<span class="parabreak"></span>'].map(
      (el) => new RegExp(el, 'gm')
    );
    html = html.replace(/&nbsp;/g, ' '); // hard spaces
    blocks.forEach((el) => (html = html.replace(el, '\n')));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let text = doc.body.textContent ?? ''; // this does most of the work to remove html tags
    if (type == TargetType.scripture || type == TargetType.jwonline) {
      text = text
        .replace(/ {2}/gm, ' ') // remove doubled spaces
        .replace(/([,.;])(\w)/gm, '$1 $2') // punctuation without a space after
        .replace(/[\+\*\#]/gm, '') // remove symbols used for annotations
        .replace(/\r\n/gm, '\n')
        .replace(/\n{2,4}/gm, '\n') // single linebreaks only
    } else if (type == TargetType.pubNav) {
      text = text
        .replace(/\t/gm, ' ') // tabs
        .replace(/[\n\r]/gm, ' ');
    }
    text = text.replace(/ {2,}/gmi, ' '); // reduce multiple spaces to one
    return text.trim();
  }

  /**
   * Returns the first X words from the sentence provided
   * @param {string} sentence
   * @param {number} count how many words
   * @returns {string}
   */
  static firstXWords(sentence, count) {
    const words = sentence.split(/\s/);
    if (words.length > count) {
      return words.slice(0, count).join(' ') + '…';
    } else {
      return sentence;
    }
  }
}

class JWLLinkerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const default_template = '{title}\n{text}\n';
    const rows = 3;
    const cols = 25;

    containerEl.empty();

    new Setting(containerEl)
      .setName(this.plugin.manifest.name)
      .setDesc('📝 Templates all accept the following substitutions: {title}, {text}')
      .setHeading();

    new Setting(containerEl)
      .setName('Scripture citation template')
      .setDesc('Use this template when citing entire Bible verses.')
      .addTextArea((text) => {
        text
          .setPlaceholder(default_template)
          .setValue(this.plugin.settings.scriptureTemplate)
          .onChange(async (value) => {
            this.plugin.settings.scriptureTemplate = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = rows;
        text.inputEl.cols = cols;
      });

    new Setting(containerEl)
      .setName('Paragraph citation template')
      .setDesc(
        'Use this template when citing an entire paragraph from a publication.'
      )
      .addTextArea((text) => {
        text
          .setPlaceholder(default_template)
          .setValue(this.plugin.settings.paragraphTemplate)
          .onChange(async (value) => {
            this.plugin.settings.paragraphTemplate = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = rows;
        text.inputEl.cols = cols;
      });
      
    new Setting(containerEl)
      .setName('Snippet citation template')
      .setDesc(
        'Use this template when citing a short snippet from a scripture or a publication.'
      )
      .addTextArea((text) => {
        text
          .setPlaceholder(default_template)
          .setValue(this.plugin.settings.snippetTemplate)
          .onChange(async (value) => {
            this.plugin.settings.snippetTemplate = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = rows;
        text.inputEl.cols = cols;
      });
      
    new Setting(containerEl)
      .setName('Snippet word length')
      .setDesc(
        'Restrict the snippet length to this many words (1-100).'
      )
      .addSlider((sld) => {
        sld
          .setDynamicTooltip()
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.snippetWords)
          .onChange(async (value) => {
            this.plugin.settings.snippetWords = value;
            await this.plugin.saveSettings();
          })
          .showTooltip();
      });

    new Setting(containerEl)
      .setName('Verse numbers in bold')
      .setDesc(
        'Apply bold markup to verse or paragraph numbers in the cited text — to better distinguish them.'
      )
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.boldVerseNo).onChange(async (value) => {
          this.plugin.settings.boldVerseNo = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Link to cited scripture')
      .setDesc('Add a JW Library link also when inserting scripture citations.')
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.citationLink).onChange(async (value) => {
          this.plugin.settings.citationLink = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName('Reset').setHeading();

    new Setting(containerEl)
      .setName('Reset all to default')
      .setDesc('Return all settings to their original defaults. ⚠️ This cannot be undone.')
      .addButton((btn) => {
        btn.setIcon('reset')
        btn.onClick(async () => {
          Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
          await this.plugin.saveSettings();
          this.display();
        });
      });
  }
}

const CiteType = {
  scriptureEntire: 'scriptureEntire',
  scriptureSnippet: 'scriptureSnippet',
  wolEntire: 'wolEntire',
  wolSnippet: 'wolSnippet',
  wolTitle: 'wolTitle',
}

const TargetType = {
  scripture: 'scripture',
  jwonline: 'jwonline',
  pubNav: 'pubNav',
}

const DisplayType = {
  url: 'url', // HTML href link <a>...</a>
  md: 'md', // Markdown link [](...)
  plain: 'plain', // No link, proper case, expand abbreviations
  first: 'first', // Just the first verse only, no extra ranges
  cite: 'cite', // Fetch and insert the full verse text
};

const ResultError = {
  none: 'none',
  invalidScripture: 'invalidScripture',
  invalidUrl: 'invalidUrl',
  oneReferenceOnly: 'oneReferenceOnly',
  onlineLookupFailed: 'onlineLookupFailed',
};

const Bible = {
  EN: {
    Book: [
      'Genesis',
      'Exodus',
      'Leviticus',
      'Numbers',
      'Deuteronomy',
      'Joshua',
      'Judges',
      'Ruth',
      '1 Samuel',
      '2 Samuel',
      '1 Kings',
      '2 Kings',
      '1 Chronicles',
      '2 Chronicles',
      'Ezra',
      'Nehemiah',
      'Esther',
      'Job',
      'Psalms',
      'Proverbs',
      'Ecclesiastes',
      'Song of Solomon',
      'Isaiah',
      'Jeremiah',
      'Lamentations',
      'Ezekiel',
      'Daniel',
      'Hosea',
      'Joel',
      'Amos',
      'Obadiah',
      'Jonah',
      'Micah',
      'Nahum',
      'Habakkuk',
      'Zephaniah',
      'Haggai',
      'Zechariah',
      'Malachi',
      'Matthew',
      'Mark',
      'Luke',
      'John',
      'Acts',
      'Romans',
      '1 Corinthians',
      '2 Corinthians',
      'Galatians',
      'Ephesians',
      'Philippians',
      'Colossians',
      '1 Thessalonians',
      '2 Thessalonians',
      '1 Timothy',
      '2 Timothy',
      'Titus',
      'Philemon',
      'Hebrews',
      'James',
      '1 Peter',
      '2 Peter',
      '1 John',
      '2 John',
      '3 John',
      'Jude',
      'Revelation',
    ],
    Abbreviation: [
      'genesis ge gen',
      'exodus ex exod',
      'leviticus le lev',
      'numbers nu num',
      'deuteronomy de deut',
      'joshua jos josh',
      'judges jg judg',
      'ruth ru',
      '1samuel 1sa 1sam',
      '2samuel 2sa 2sam',
      '1kings 1ki 1kg',
      '2kings 2ki 2kg',
      '1chronicles 1ch 1chr',
      '2chronicles 2ch 2chr',
      'ezra ezr',
      'nehemiah ne nem',
      'esther es est',
      'job jb',
      'psalms ps psa',
      'proverbs pr pro prov',
      'ecclesiastes ec ecc eccl',
      'song of solomon canticles ca sos sng song',
      'isaiah isa',
      'jeremiah jer',
      'lamentations la lam',
      'ezekiel eze',
      'daniel da dan',
      'hosea ho hos',
      'joel joe joel',
      'amos am amo amos',
      'obadiah ob oba',
      'jonah jon',
      'micah mic',
      'nahum na nah',
      'habakkuk hab',
      'zephaniah zep zeph',
      'haggai hag',
      'zechariah zec zech',
      'malachi mal',
      'matthew mt mat matt',
      'mark mr mk mark',
      'luke lu luke',
      'john joh john',
      'acts ac act',
      'romans ro rom',
      '1corinthians 1co 1cor',
      '2corinthians 2co 2cor',
      'galatians ga gal',
      'ephesians eph',
      'philippians php',
      'colossians col',
      '1thessalonians 1th',
      '2thessalonians 2th',
      '1timothy 1ti 1tim',
      '2timothy 2ti 2tim',
      'titus ti tit',
      'philemon phm',
      'hebrews heb',
      'james jas',
      '1peter 1pe 1pet',
      '2peter 2pe 2pet',
      '1john 1jo 1joh',
      '2john 2jo 2joh',
      '3john 3jo 3joh',
      'jude jud jude',
      'revelation re rev',
    ],
  },
  FR: {
    Book: [
      'Genèse',
      'Exode',
      'Lévitique',
      'Nombres',
      'Deutéronome',
      'Josué',
      'Juges',
      'Ruth',
      '1 Samuel',
      '2 Samuel',
      '1 Rois',
      '2 Rois',
      '1 Chroniques',
      '2 Chroniques',
      'Esdras',
      'Néhémie',
      'Esther',
      'Job',
      'Psaumes',
      'Proverbes',
      'Ecclésiaste',
      'Chant de Salomon',
      'Isaïe',
      'Jérémie',
      'Lamentations',
      'Ézéchiel',
      'Daniel',
      'Osée',
      'Joël',
      'Amos',
      'Abdias',
      'Jonas',
      'Michée',
      'Nahum',
      'Habacuc',
      'Sophonie',
      'Aggée',
      'Zacharie',
      'Malachie',
      'Matthieu',
      'Marc',
      'Luc',
      'Jean',
      'Actes',
      'Romains',
      '1 Corinthiens',
      '2 Corinthiens',
      'Galates',
      'Éphésiens',
      'Philippiens',
      'Colossiens',
      '1 Thessaloniciens',
      '2 Thessaloniciens',
      '1 Timothée',
      '2 Timothée',
      'Tite',
      'Philémon',
      'Hébreux',
      'Jacques',
      '1 Pierre',
      '2 Pierre',
      '1 Jean',
      '2 Jean',
      '3 Jean',
      'Jude',
      'Révélation',
    ],
    Abbreviation: [
      'genèse gen ge',
      'exode exo ex',
      'lévitique lev le',
      'nombres nom',
      'deutéronome de deu deut',
      'josué jos',
      'juges jug',
      'ruth ru',
      '1samuel 1sam 1sa',
      '2samuel 1sam 2sa',
      '1rois 1ro',
      '2rois 2ro',
      '1chroniques 1chr 1ch',
      '2chroniques 2chr 2ch',
      'esdras esd',
      'néhémie neh',
      'esther est',
      'job',
      'psaumes psa ps',
      'proverbes pr pro prov',
      'ecclésiaste ec ecc eccl',
      'chant de salomon chant',
      'isaïe isa is',
      'jérémie jer',
      'lamentations lam la',
      'ézéchiel eze ez',
      'daniel dan da',
      'osée os',
      'joël',
      'amos',
      'abdias abd ab',
      'jonas',
      'michée mic',
      'nahum',
      'habacuc hab',
      'sophonie sph sop',
      'aggée agg ag',
      'zacharie zac',
      'malachie mal',
      'matthieu mt mat matt',
      'marc',
      'luc',
      'jean',
      'actes ac',
      'romains rom ro',
      '1corinthiens 1cor 1co',
      '2corinthiens 2cor 2co',
      'galates gal ga',
      'éphésiens eph',
      'philippiens phil',
      'colossiens col',
      '1thessaloniciens 1th',
      '2thessaloniciens 2th',
      '1timothée 1tim 1ti',
      '2timothée 2tim 2ti',
      'tite',
      'philémon phm',
      'hébreux heb he',
      'jacques jac',
      '1pierre 1pi',
      '2pierre 2pi',
      '1jean 1je',
      '2jean 2je',
      '3jean 3 je',
      'jude',
      'révélation rev re',
    ],
  },
};

const BibleDimensions = {
  'Genesis 1': 31,
  'Genesis 2': 25,
  'Genesis 3': 24,
  'Genesis 4': 26,
  'Genesis 5': 32,
  'Genesis 6': 22,
  'Genesis 7': 24,
  'Genesis 8': 22,
  'Genesis 9': 29,
  'Genesis 10': 32,
  'Genesis 11': 32,
  'Genesis 12': 20,
  'Genesis 13': 18,
  'Genesis 14': 24,
  'Genesis 15': 21,
  'Genesis 16': 16,
  'Genesis 17': 27,
  'Genesis 18': 33,
  'Genesis 19': 38,
  'Genesis 20': 18,
  'Genesis 21': 34,
  'Genesis 22': 24,
  'Genesis 23': 20,
  'Genesis 24': 67,
  'Genesis 25': 34,
  'Genesis 26': 35,
  'Genesis 27': 46,
  'Genesis 28': 22,
  'Genesis 29': 35,
  'Genesis 30': 43,
  'Genesis 31': 55,
  'Genesis 32': 32,
  'Genesis 33': 20,
  'Genesis 34': 31,
  'Genesis 35': 29,
  'Genesis 36': 43,
  'Genesis 37': 36,
  'Genesis 38': 30,
  'Genesis 39': 23,
  'Genesis 40': 23,
  'Genesis 41': 57,
  'Genesis 42': 38,
  'Genesis 43': 34,
  'Genesis 44': 34,
  'Genesis 45': 28,
  'Genesis 46': 34,
  'Genesis 47': 31,
  'Genesis 48': 22,
  'Genesis 49': 33,
  'Genesis 50': 26,
  'Exodus 1': 22,
  'Exodus 2': 25,
  'Exodus 3': 22,
  'Exodus 4': 31,
  'Exodus 5': 23,
  'Exodus 6': 30,
  'Exodus 7': 25,
  'Exodus 8': 32,
  'Exodus 9': 35,
  'Exodus 10': 29,
  'Exodus 11': 10,
  'Exodus 12': 51,
  'Exodus 13': 22,
  'Exodus 14': 31,
  'Exodus 15': 27,
  'Exodus 16': 36,
  'Exodus 17': 16,
  'Exodus 18': 27,
  'Exodus 19': 25,
  'Exodus 20': 26,
  'Exodus 21': 36,
  'Exodus 22': 31,
  'Exodus 23': 33,
  'Exodus 24': 18,
  'Exodus 25': 40,
  'Exodus 26': 37,
  'Exodus 27': 21,
  'Exodus 28': 43,
  'Exodus 29': 46,
  'Exodus 30': 38,
  'Exodus 31': 18,
  'Exodus 32': 35,
  'Exodus 33': 23,
  'Exodus 34': 35,
  'Exodus 35': 35,
  'Exodus 36': 38,
  'Exodus 37': 29,
  'Exodus 38': 31,
  'Exodus 39': 43,
  'Exodus 40': 38,
  'Leviticus 1': 17,
  'Leviticus 2': 16,
  'Leviticus 3': 17,
  'Leviticus 4': 35,
  'Leviticus 5': 19,
  'Leviticus 6': 30,
  'Leviticus 7': 38,
  'Leviticus 8': 36,
  'Leviticus 9': 24,
  'Leviticus 10': 20,
  'Leviticus 11': 47,
  'Leviticus 12': 8,
  'Leviticus 13': 59,
  'Leviticus 14': 57,
  'Leviticus 15': 33,
  'Leviticus 16': 34,
  'Leviticus 17': 16,
  'Leviticus 18': 30,
  'Leviticus 19': 37,
  'Leviticus 20': 27,
  'Leviticus 21': 24,
  'Leviticus 22': 33,
  'Leviticus 23': 44,
  'Leviticus 24': 23,
  'Leviticus 25': 55,
  'Leviticus 26': 46,
  'Leviticus 27': 34,
  'Numbers 1': 54,
  'Numbers 2': 34,
  'Numbers 3': 51,
  'Numbers 4': 49,
  'Numbers 5': 31,
  'Numbers 6': 27,
  'Numbers 7': 89,
  'Numbers 8': 26,
  'Numbers 9': 23,
  'Numbers 10': 36,
  'Numbers 11': 35,
  'Numbers 12': 16,
  'Numbers 13': 33,
  'Numbers 14': 45,
  'Numbers 15': 41,
  'Numbers 16': 50,
  'Numbers 17': 13,
  'Numbers 18': 32,
  'Numbers 19': 22,
  'Numbers 20': 29,
  'Numbers 21': 35,
  'Numbers 22': 41,
  'Numbers 23': 30,
  'Numbers 24': 25,
  'Numbers 25': 18,
  'Numbers 26': 65,
  'Numbers 27': 23,
  'Numbers 28': 31,
  'Numbers 29': 40,
  'Numbers 30': 16,
  'Numbers 31': 54,
  'Numbers 32': 42,
  'Numbers 33': 56,
  'Numbers 34': 29,
  'Numbers 35': 34,
  'Numbers 36': 13,
  'Deuteronomy 1': 46,
  'Deuteronomy 2': 37,
  'Deuteronomy 3': 29,
  'Deuteronomy 4': 49,
  'Deuteronomy 5': 33,
  'Deuteronomy 6': 25,
  'Deuteronomy 7': 26,
  'Deuteronomy 8': 20,
  'Deuteronomy 9': 29,
  'Deuteronomy 10': 22,
  'Deuteronomy 11': 32,
  'Deuteronomy 12': 32,
  'Deuteronomy 13': 18,
  'Deuteronomy 14': 29,
  'Deuteronomy 15': 23,
  'Deuteronomy 16': 22,
  'Deuteronomy 17': 20,
  'Deuteronomy 18': 22,
  'Deuteronomy 19': 21,
  'Deuteronomy 20': 20,
  'Deuteronomy 21': 23,
  'Deuteronomy 22': 30,
  'Deuteronomy 23': 25,
  'Deuteronomy 24': 22,
  'Deuteronomy 25': 19,
  'Deuteronomy 26': 19,
  'Deuteronomy 27': 26,
  'Deuteronomy 28': 68,
  'Deuteronomy 29': 29,
  'Deuteronomy 30': 20,
  'Deuteronomy 31': 30,
  'Deuteronomy 32': 52,
  'Deuteronomy 33': 29,
  'Deuteronomy 34': 12,
  'Joshua 1': 18,
  'Joshua 2': 24,
  'Joshua 3': 17,
  'Joshua 4': 24,
  'Joshua 5': 15,
  'Joshua 6': 27,
  'Joshua 7': 26,
  'Joshua 8': 35,
  'Joshua 9': 27,
  'Joshua 10': 43,
  'Joshua 11': 23,
  'Joshua 12': 24,
  'Joshua 13': 33,
  'Joshua 14': 15,
  'Joshua 15': 63,
  'Joshua 16': 10,
  'Joshua 17': 18,
  'Joshua 18': 28,
  'Joshua 19': 51,
  'Joshua 20': 9,
  'Joshua 21': 45,
  'Joshua 22': 34,
  'Joshua 23': 16,
  'Joshua 24': 33,
  'Judges 1': 36,
  'Judges 2': 23,
  'Judges 3': 31,
  'Judges 4': 24,
  'Judges 5': 31,
  'Judges 6': 40,
  'Judges 7': 25,
  'Judges 8': 35,
  'Judges 9': 57,
  'Judges 10': 18,
  'Judges 11': 40,
  'Judges 12': 15,
  'Judges 13': 25,
  'Judges 14': 20,
  'Judges 15': 20,
  'Judges 16': 31,
  'Judges 17': 13,
  'Judges 18': 31,
  'Judges 19': 30,
  'Judges 20': 48,
  'Judges 21': 25,
  'Ruth 1': 22,
  'Ruth 2': 23,
  'Ruth 3': 18,
  'Ruth 4': 22,
  '1 Samuel 1': 28,
  '1 Samuel 2': 36,
  '1 Samuel 3': 21,
  '1 Samuel 4': 22,
  '1 Samuel 5': 12,
  '1 Samuel 6': 21,
  '1 Samuel 7': 17,
  '1 Samuel 8': 22,
  '1 Samuel 9': 27,
  '1 Samuel 10': 27,
  '1 Samuel 11': 15,
  '1 Samuel 12': 25,
  '1 Samuel 13': 23,
  '1 Samuel 14': 52,
  '1 Samuel 15': 35,
  '1 Samuel 16': 23,
  '1 Samuel 17': 58,
  '1 Samuel 18': 30,
  '1 Samuel 19': 24,
  '1 Samuel 20': 42,
  '1 Samuel 21': 15,
  '1 Samuel 22': 23,
  '1 Samuel 23': 29,
  '1 Samuel 24': 22,
  '1 Samuel 25': 44,
  '1 Samuel 26': 25,
  '1 Samuel 27': 12,
  '1 Samuel 28': 25,
  '1 Samuel 29': 11,
  '1 Samuel 30': 31,
  '1 Samuel 31': 13,
  '2 Samuel 1': 27,
  '2 Samuel 2': 32,
  '2 Samuel 3': 39,
  '2 Samuel 4': 12,
  '2 Samuel 5': 25,
  '2 Samuel 6': 23,
  '2 Samuel 7': 29,
  '2 Samuel 8': 18,
  '2 Samuel 9': 13,
  '2 Samuel 10': 19,
  '2 Samuel 11': 27,
  '2 Samuel 12': 31,
  '2 Samuel 13': 39,
  '2 Samuel 14': 33,
  '2 Samuel 15': 37,
  '2 Samuel 16': 23,
  '2 Samuel 17': 29,
  '2 Samuel 18': 33,
  '2 Samuel 19': 43,
  '2 Samuel 20': 26,
  '2 Samuel 21': 22,
  '2 Samuel 22': 51,
  '2 Samuel 23': 39,
  '2 Samuel 24': 25,
  '1 Kings 1': 53,
  '1 Kings 2': 46,
  '1 Kings 3': 28,
  '1 Kings 4': 34,
  '1 Kings 5': 18,
  '1 Kings 6': 38,
  '1 Kings 7': 51,
  '1 Kings 8': 66,
  '1 Kings 9': 28,
  '1 Kings 10': 29,
  '1 Kings 11': 43,
  '1 Kings 12': 33,
  '1 Kings 13': 34,
  '1 Kings 14': 31,
  '1 Kings 15': 34,
  '1 Kings 16': 34,
  '1 Kings 17': 24,
  '1 Kings 18': 46,
  '1 Kings 19': 21,
  '1 Kings 20': 43,
  '1 Kings 21': 29,
  '1 Kings 22': 53,
  '2 Kings 1': 18,
  '2 Kings 2': 25,
  '2 Kings 3': 27,
  '2 Kings 4': 44,
  '2 Kings 5': 27,
  '2 Kings 6': 33,
  '2 Kings 7': 20,
  '2 Kings 8': 29,
  '2 Kings 9': 37,
  '2 Kings 10': 36,
  '2 Kings 11': 21,
  '2 Kings 12': 21,
  '2 Kings 13': 25,
  '2 Kings 14': 29,
  '2 Kings 15': 38,
  '2 Kings 16': 20,
  '2 Kings 17': 41,
  '2 Kings 18': 37,
  '2 Kings 19': 37,
  '2 Kings 20': 21,
  '2 Kings 21': 26,
  '2 Kings 22': 20,
  '2 Kings 23': 37,
  '2 Kings 24': 20,
  '2 Kings 25': 30,
  '1 Chronicles 1': 54,
  '1 Chronicles 2': 55,
  '1 Chronicles 3': 24,
  '1 Chronicles 4': 43,
  '1 Chronicles 5': 26,
  '1 Chronicles 6': 81,
  '1 Chronicles 7': 40,
  '1 Chronicles 8': 40,
  '1 Chronicles 9': 44,
  '1 Chronicles 10': 14,
  '1 Chronicles 11': 47,
  '1 Chronicles 12': 40,
  '1 Chronicles 13': 14,
  '1 Chronicles 14': 17,
  '1 Chronicles 15': 29,
  '1 Chronicles 16': 43,
  '1 Chronicles 17': 27,
  '1 Chronicles 18': 17,
  '1 Chronicles 19': 19,
  '1 Chronicles 20': 8,
  '1 Chronicles 21': 30,
  '1 Chronicles 22': 19,
  '1 Chronicles 23': 32,
  '1 Chronicles 24': 31,
  '1 Chronicles 25': 31,
  '1 Chronicles 26': 32,
  '1 Chronicles 27': 34,
  '1 Chronicles 28': 21,
  '1 Chronicles 29': 30,
  '2 Chronicles 1': 17,
  '2 Chronicles 2': 18,
  '2 Chronicles 3': 17,
  '2 Chronicles 4': 22,
  '2 Chronicles 5': 14,
  '2 Chronicles 6': 42,
  '2 Chronicles 7': 22,
  '2 Chronicles 8': 18,
  '2 Chronicles 9': 31,
  '2 Chronicles 10': 19,
  '2 Chronicles 11': 23,
  '2 Chronicles 12': 16,
  '2 Chronicles 13': 22,
  '2 Chronicles 14': 15,
  '2 Chronicles 15': 19,
  '2 Chronicles 16': 14,
  '2 Chronicles 17': 19,
  '2 Chronicles 18': 34,
  '2 Chronicles 19': 11,
  '2 Chronicles 20': 37,
  '2 Chronicles 21': 20,
  '2 Chronicles 22': 12,
  '2 Chronicles 23': 21,
  '2 Chronicles 24': 27,
  '2 Chronicles 25': 28,
  '2 Chronicles 26': 23,
  '2 Chronicles 27': 9,
  '2 Chronicles 28': 27,
  '2 Chronicles 29': 36,
  '2 Chronicles 30': 27,
  '2 Chronicles 31': 21,
  '2 Chronicles 32': 33,
  '2 Chronicles 33': 25,
  '2 Chronicles 34': 33,
  '2 Chronicles 35': 27,
  '2 Chronicles 36': 23,
  'Ezra 1': 11,
  'Ezra 2': 70,
  'Ezra 3': 13,
  'Ezra 4': 24,
  'Ezra 5': 17,
  'Ezra 6': 22,
  'Ezra 7': 28,
  'Ezra 8': 36,
  'Ezra 9': 15,
  'Ezra 10': 44,
  'Nehemiah 1': 11,
  'Nehemiah 2': 20,
  'Nehemiah 3': 32,
  'Nehemiah 4': 23,
  'Nehemiah 5': 19,
  'Nehemiah 6': 19,
  'Nehemiah 7': 73,
  'Nehemiah 8': 18,
  'Nehemiah 9': 38,
  'Nehemiah 10': 39,
  'Nehemiah 11': 36,
  'Nehemiah 12': 47,
  'Nehemiah 13': 31,
  'Esther 1': 22,
  'Esther 2': 23,
  'Esther 3': 15,
  'Esther 4': 17,
  'Esther 5': 14,
  'Esther 6': 14,
  'Esther 7': 10,
  'Esther 8': 17,
  'Esther 9': 32,
  'Esther 10': 3,
  'Job 1': 22,
  'Job 2': 13,
  'Job 3': 26,
  'Job 4': 21,
  'Job 5': 27,
  'Job 6': 30,
  'Job 7': 21,
  'Job 8': 22,
  'Job 9': 35,
  'Job 10': 22,
  'Job 11': 20,
  'Job 12': 25,
  'Job 13': 28,
  'Job 14': 22,
  'Job 15': 35,
  'Job 16': 22,
  'Job 17': 16,
  'Job 18': 21,
  'Job 19': 29,
  'Job 20': 29,
  'Job 21': 34,
  'Job 22': 30,
  'Job 23': 17,
  'Job 24': 25,
  'Job 25': 6,
  'Job 26': 14,
  'Job 27': 23,
  'Job 28': 28,
  'Job 29': 25,
  'Job 30': 31,
  'Job 31': 40,
  'Job 32': 22,
  'Job 33': 33,
  'Job 34': 37,
  'Job 35': 16,
  'Job 36': 33,
  'Job 37': 24,
  'Job 38': 41,
  'Job 39': 30,
  'Job 40': 24,
  'Job 41': 34,
  'Job 42': 17,
  'Psalms 1': 6,
  'Psalms 2': 12,
  'Psalms 3': 8,
  'Psalms 4': 8,
  'Psalms 5': 12,
  'Psalms 6': 10,
  'Psalms 7': 17,
  'Psalms 8': 9,
  'Psalms 9': 20,
  'Psalms 10': 18,
  'Psalms 11': 7,
  'Psalms 12': 8,
  'Psalms 13': 6,
  'Psalms 14': 7,
  'Psalms 15': 5,
  'Psalms 16': 11,
  'Psalms 17': 15,
  'Psalms 18': 50,
  'Psalms 19': 14,
  'Psalms 20': 9,
  'Psalms 21': 13,
  'Psalms 22': 31,
  'Psalms 23': 6,
  'Psalms 24': 10,
  'Psalms 25': 22,
  'Psalms 26': 12,
  'Psalms 27': 14,
  'Psalms 28': 9,
  'Psalms 29': 11,
  'Psalms 30': 12,
  'Psalms 31': 24,
  'Psalms 32': 11,
  'Psalms 33': 22,
  'Psalms 34': 22,
  'Psalms 35': 28,
  'Psalms 36': 12,
  'Psalms 37': 40,
  'Psalms 38': 22,
  'Psalms 39': 13,
  'Psalms 40': 17,
  'Psalms 41': 13,
  'Psalms 42': 11,
  'Psalms 43': 5,
  'Psalms 44': 26,
  'Psalms 45': 17,
  'Psalms 46': 11,
  'Psalms 47': 9,
  'Psalms 48': 14,
  'Psalms 49': 20,
  'Psalms 50': 23,
  'Psalms 51': 19,
  'Psalms 52': 9,
  'Psalms 53': 6,
  'Psalms 54': 7,
  'Psalms 55': 23,
  'Psalms 56': 13,
  'Psalms 57': 11,
  'Psalms 58': 11,
  'Psalms 59': 17,
  'Psalms 60': 12,
  'Psalms 61': 8,
  'Psalms 62': 12,
  'Psalms 63': 11,
  'Psalms 64': 10,
  'Psalms 65': 13,
  'Psalms 66': 20,
  'Psalms 67': 7,
  'Psalms 68': 35,
  'Psalms 69': 36,
  'Psalms 70': 5,
  'Psalms 71': 24,
  'Psalms 72': 20,
  'Psalms 73': 28,
  'Psalms 74': 23,
  'Psalms 75': 10,
  'Psalms 76': 12,
  'Psalms 77': 20,
  'Psalms 78': 72,
  'Psalms 79': 13,
  'Psalms 80': 19,
  'Psalms 81': 16,
  'Psalms 82': 8,
  'Psalms 83': 18,
  'Psalms 84': 12,
  'Psalms 85': 13,
  'Psalms 86': 17,
  'Psalms 87': 7,
  'Psalms 88': 18,
  'Psalms 89': 52,
  'Psalms 90': 17,
  'Psalms 91': 16,
  'Psalms 92': 15,
  'Psalms 93': 5,
  'Psalms 94': 23,
  'Psalms 95': 11,
  'Psalms 96': 13,
  'Psalms 97': 12,
  'Psalms 98': 9,
  'Psalms 99': 9,
  'Psalms 100': 5,
  'Psalms 101': 8,
  'Psalms 102': 28,
  'Psalms 103': 22,
  'Psalms 104': 35,
  'Psalms 105': 45,
  'Psalms 106': 48,
  'Psalms 107': 43,
  'Psalms 108': 13,
  'Psalms 109': 31,
  'Psalms 110': 7,
  'Psalms 111': 10,
  'Psalms 112': 10,
  'Psalms 113': 9,
  'Psalms 114': 8,
  'Psalms 115': 18,
  'Psalms 116': 19,
  'Psalms 117': 2,
  'Psalms 118': 29,
  'Psalms 119': 176,
  'Psalms 120': 7,
  'Psalms 121': 8,
  'Psalms 122': 9,
  'Psalms 123': 4,
  'Psalms 124': 8,
  'Psalms 125': 5,
  'Psalms 126': 6,
  'Psalms 127': 5,
  'Psalms 128': 6,
  'Psalms 129': 8,
  'Psalms 130': 8,
  'Psalms 131': 3,
  'Psalms 132': 18,
  'Psalms 133': 3,
  'Psalms 134': 3,
  'Psalms 135': 21,
  'Psalms 136': 26,
  'Psalms 137': 9,
  'Psalms 138': 8,
  'Psalms 139': 24,
  'Psalms 140': 13,
  'Psalms 141': 10,
  'Psalms 142': 7,
  'Psalms 143': 12,
  'Psalms 144': 15,
  'Psalms 145': 21,
  'Psalms 146': 10,
  'Psalms 147': 20,
  'Psalms 148': 14,
  'Psalms 149': 9,
  'Psalms 150': 6,
  'Proverbs 1': 33,
  'Proverbs 2': 22,
  'Proverbs 3': 35,
  'Proverbs 4': 27,
  'Proverbs 5': 23,
  'Proverbs 6': 35,
  'Proverbs 7': 27,
  'Proverbs 8': 36,
  'Proverbs 9': 18,
  'Proverbs 10': 32,
  'Proverbs 11': 31,
  'Proverbs 12': 28,
  'Proverbs 13': 25,
  'Proverbs 14': 35,
  'Proverbs 15': 33,
  'Proverbs 16': 33,
  'Proverbs 17': 28,
  'Proverbs 18': 24,
  'Proverbs 19': 29,
  'Proverbs 20': 30,
  'Proverbs 21': 31,
  'Proverbs 22': 29,
  'Proverbs 23': 35,
  'Proverbs 24': 34,
  'Proverbs 25': 28,
  'Proverbs 26': 28,
  'Proverbs 27': 27,
  'Proverbs 28': 28,
  'Proverbs 29': 27,
  'Proverbs 30': 33,
  'Proverbs 31': 31,
  'Ecclesiastes 1': 18,
  'Ecclesiastes 2': 26,
  'Ecclesiastes 3': 22,
  'Ecclesiastes 4': 16,
  'Ecclesiastes 5': 20,
  'Ecclesiastes 6': 12,
  'Ecclesiastes 7': 29,
  'Ecclesiastes 8': 17,
  'Ecclesiastes 9': 18,
  'Ecclesiastes 10': 20,
  'Ecclesiastes 11': 10,
  'Ecclesiastes 12': 14,
  'Song of Solomon 1': 17,
  'Song of Solomon 2': 17,
  'Song of Solomon 3': 11,
  'Song of Solomon 4': 16,
  'Song of Solomon 5': 16,
  'Song of Solomon 6': 13,
  'Song of Solomon 7': 13,
  'Song of Solomon 8': 14,
  'Isaiah 1': 31,
  'Isaiah 2': 22,
  'Isaiah 3': 26,
  'Isaiah 4': 6,
  'Isaiah 5': 30,
  'Isaiah 6': 13,
  'Isaiah 7': 25,
  'Isaiah 8': 22,
  'Isaiah 9': 21,
  'Isaiah 10': 34,
  'Isaiah 11': 16,
  'Isaiah 12': 6,
  'Isaiah 13': 22,
  'Isaiah 14': 32,
  'Isaiah 15': 9,
  'Isaiah 16': 14,
  'Isaiah 17': 14,
  'Isaiah 18': 7,
  'Isaiah 19': 25,
  'Isaiah 20': 6,
  'Isaiah 21': 17,
  'Isaiah 22': 25,
  'Isaiah 23': 18,
  'Isaiah 24': 23,
  'Isaiah 25': 12,
  'Isaiah 26': 21,
  'Isaiah 27': 13,
  'Isaiah 28': 29,
  'Isaiah 29': 24,
  'Isaiah 30': 33,
  'Isaiah 31': 9,
  'Isaiah 32': 20,
  'Isaiah 33': 24,
  'Isaiah 34': 17,
  'Isaiah 35': 10,
  'Isaiah 36': 22,
  'Isaiah 37': 38,
  'Isaiah 38': 22,
  'Isaiah 39': 8,
  'Isaiah 40': 31,
  'Isaiah 41': 29,
  'Isaiah 42': 25,
  'Isaiah 43': 28,
  'Isaiah 44': 28,
  'Isaiah 45': 25,
  'Isaiah 46': 13,
  'Isaiah 47': 15,
  'Isaiah 48': 22,
  'Isaiah 49': 26,
  'Isaiah 50': 11,
  'Isaiah 51': 23,
  'Isaiah 52': 15,
  'Isaiah 53': 12,
  'Isaiah 54': 17,
  'Isaiah 55': 13,
  'Isaiah 56': 12,
  'Isaiah 57': 21,
  'Isaiah 58': 14,
  'Isaiah 59': 21,
  'Isaiah 60': 22,
  'Isaiah 61': 11,
  'Isaiah 62': 12,
  'Isaiah 63': 19,
  'Isaiah 64': 12,
  'Isaiah 65': 25,
  'Isaiah 66': 24,
  'Jeremiah 1': 19,
  'Jeremiah 2': 37,
  'Jeremiah 3': 25,
  'Jeremiah 4': 31,
  'Jeremiah 5': 31,
  'Jeremiah 6': 30,
  'Jeremiah 7': 34,
  'Jeremiah 8': 22,
  'Jeremiah 9': 26,
  'Jeremiah 10': 25,
  'Jeremiah 11': 23,
  'Jeremiah 12': 17,
  'Jeremiah 13': 27,
  'Jeremiah 14': 22,
  'Jeremiah 15': 21,
  'Jeremiah 16': 21,
  'Jeremiah 17': 27,
  'Jeremiah 18': 23,
  'Jeremiah 19': 15,
  'Jeremiah 20': 18,
  'Jeremiah 21': 14,
  'Jeremiah 22': 30,
  'Jeremiah 23': 40,
  'Jeremiah 24': 10,
  'Jeremiah 25': 38,
  'Jeremiah 26': 24,
  'Jeremiah 27': 22,
  'Jeremiah 28': 17,
  'Jeremiah 29': 32,
  'Jeremiah 30': 24,
  'Jeremiah 31': 40,
  'Jeremiah 32': 44,
  'Jeremiah 33': 26,
  'Jeremiah 34': 22,
  'Jeremiah 35': 19,
  'Jeremiah 36': 32,
  'Jeremiah 37': 21,
  'Jeremiah 38': 28,
  'Jeremiah 39': 18,
  'Jeremiah 40': 16,
  'Jeremiah 41': 18,
  'Jeremiah 42': 22,
  'Jeremiah 43': 13,
  'Jeremiah 44': 30,
  'Jeremiah 45': 5,
  'Jeremiah 46': 28,
  'Jeremiah 47': 7,
  'Jeremiah 48': 47,
  'Jeremiah 49': 39,
  'Jeremiah 50': 46,
  'Jeremiah 51': 64,
  'Jeremiah 52': 34,
  'Lamentations 1': 22,
  'Lamentations 2': 22,
  'Lamentations 3': 66,
  'Lamentations 4': 22,
  'Lamentations 5': 22,
  'Ezekiel 1': 28,
  'Ezekiel 2': 10,
  'Ezekiel 3': 27,
  'Ezekiel 4': 17,
  'Ezekiel 5': 17,
  'Ezekiel 6': 14,
  'Ezekiel 7': 27,
  'Ezekiel 8': 18,
  'Ezekiel 9': 11,
  'Ezekiel 10': 22,
  'Ezekiel 11': 25,
  'Ezekiel 12': 28,
  'Ezekiel 13': 23,
  'Ezekiel 14': 23,
  'Ezekiel 15': 8,
  'Ezekiel 16': 63,
  'Ezekiel 17': 24,
  'Ezekiel 18': 32,
  'Ezekiel 19': 14,
  'Ezekiel 20': 49,
  'Ezekiel 21': 32,
  'Ezekiel 22': 31,
  'Ezekiel 23': 49,
  'Ezekiel 24': 27,
  'Ezekiel 25': 17,
  'Ezekiel 26': 21,
  'Ezekiel 27': 36,
  'Ezekiel 28': 26,
  'Ezekiel 29': 21,
  'Ezekiel 30': 26,
  'Ezekiel 31': 18,
  'Ezekiel 32': 32,
  'Ezekiel 33': 33,
  'Ezekiel 34': 31,
  'Ezekiel 35': 15,
  'Ezekiel 36': 38,
  'Ezekiel 37': 28,
  'Ezekiel 38': 23,
  'Ezekiel 39': 29,
  'Ezekiel 40': 49,
  'Ezekiel 41': 26,
  'Ezekiel 42': 20,
  'Ezekiel 43': 27,
  'Ezekiel 44': 31,
  'Ezekiel 45': 25,
  'Ezekiel 46': 24,
  'Ezekiel 47': 23,
  'Ezekiel 48': 35,
  'Daniel 1': 21,
  'Daniel 2': 49,
  'Daniel 3': 30,
  'Daniel 4': 37,
  'Daniel 5': 31,
  'Daniel 6': 28,
  'Daniel 7': 28,
  'Daniel 8': 27,
  'Daniel 9': 27,
  'Daniel 10': 21,
  'Daniel 11': 45,
  'Daniel 12': 13,
  'Hosea 1': 11,
  'Hosea 2': 23,
  'Hosea 3': 5,
  'Hosea 4': 19,
  'Hosea 5': 15,
  'Hosea 6': 11,
  'Hosea 7': 16,
  'Hosea 8': 14,
  'Hosea 9': 17,
  'Hosea 10': 15,
  'Hosea 11': 12,
  'Hosea 12': 14,
  'Hosea 13': 16,
  'Hosea 14': 9,
  'Joel 1': 20,
  'Joel 2': 32,
  'Joel 3': 21,
  'Amos 1': 15,
  'Amos 2': 16,
  'Amos 3': 15,
  'Amos 4': 13,
  'Amos 5': 27,
  'Amos 6': 14,
  'Amos 7': 17,
  'Amos 8': 14,
  'Amos 9': 15,
  'Obadiah 1': 21,
  'Jonah 1': 17,
  'Jonah 2': 10,
  'Jonah 3': 10,
  'Jonah 4': 11,
  'Micah 1': 16,
  'Micah 2': 13,
  'Micah 3': 12,
  'Micah 4': 13,
  'Micah 5': 15,
  'Micah 6': 16,
  'Micah 7': 20,
  'Nahum 1': 15,
  'Nahum 2': 13,
  'Nahum 3': 19,
  'Habakkuk 1': 17,
  'Habakkuk 2': 20,
  'Habakkuk 3': 19,
  'Zephaniah 1': 18,
  'Zephaniah 2': 15,
  'Zephaniah 3': 20,
  'Haggai 1': 15,
  'Haggai 2': 23,
  'Zechariah 1': 21,
  'Zechariah 2': 13,
  'Zechariah 3': 10,
  'Zechariah 4': 14,
  'Zechariah 5': 11,
  'Zechariah 6': 15,
  'Zechariah 7': 14,
  'Zechariah 8': 23,
  'Zechariah 9': 17,
  'Zechariah 10': 12,
  'Zechariah 11': 17,
  'Zechariah 12': 14,
  'Zechariah 13': 9,
  'Zechariah 14': 21,
  'Malachi 1': 14,
  'Malachi 2': 17,
  'Malachi 3': 18,
  'Malachi 4': 6,
  'Matthew 1': 25,
  'Matthew 2': 23,
  'Matthew 3': 17,
  'Matthew 4': 25,
  'Matthew 5': 48,
  'Matthew 6': 34,
  'Matthew 7': 29,
  'Matthew 8': 34,
  'Matthew 9': 38,
  'Matthew 10': 42,
  'Matthew 11': 30,
  'Matthew 12': 49,
  'Matthew 13': 58,
  'Matthew 14': 36,
  'Matthew 15': 39,
  'Matthew 16': 28,
  'Matthew 17': 26,
  'Matthew 18': 34,
  'Matthew 19': 30,
  'Matthew 20': 34,
  'Matthew 21': 46,
  'Matthew 22': 46,
  'Matthew 23': 38,
  'Matthew 24': 51,
  'Matthew 25': 46,
  'Matthew 26': 75,
  'Matthew 27': 66,
  'Matthew 28': 20,
  'Mark 1': 45,
  'Mark 2': 28,
  'Mark 3': 35,
  'Mark 4': 41,
  'Mark 5': 43,
  'Mark 6': 56,
  'Mark 7': 36,
  'Mark 8': 38,
  'Mark 9': 48,
  'Mark 10': 52,
  'Mark 11': 32,
  'Mark 12': 44,
  'Mark 13': 37,
  'Mark 14': 72,
  'Mark 15': 46,
  'Mark 16': 20,
  'Luke 1': 80,
  'Luke 2': 52,
  'Luke 3': 38,
  'Luke 4': 44,
  'Luke 5': 39,
  'Luke 6': 49,
  'Luke 7': 50,
  'Luke 8': 56,
  'Luke 9': 62,
  'Luke 10': 42,
  'Luke 11': 54,
  'Luke 12': 59,
  'Luke 13': 35,
  'Luke 14': 35,
  'Luke 15': 32,
  'Luke 16': 31,
  'Luke 17': 36,
  'Luke 18': 43,
  'Luke 19': 48,
  'Luke 20': 47,
  'Luke 21': 38,
  'Luke 22': 71,
  'Luke 23': 55,
  'Luke 24': 53,
  'John 1': 51,
  'John 2': 25,
  'John 3': 36,
  'John 4': 54,
  'John 5': 46,
  'John 6': 71,
  'John 7': 52,
  'John 8': 48,
  'John 9': 41,
  'John 10': 42,
  'John 11': 57,
  'John 12': 50,
  'John 13': 38,
  'John 14': 31,
  'John 15': 27,
  'John 16': 33,
  'John 17': 26,
  'John 18': 40,
  'John 19': 42,
  'John 20': 31,
  'John 21': 25,
  'Acts 1': 26,
  'Acts 2': 47,
  'Acts 3': 26,
  'Acts 4': 37,
  'Acts 5': 42,
  'Acts 6': 15,
  'Acts 7': 60,
  'Acts 8': 39,
  'Acts 9': 43,
  'Acts 10': 48,
  'Acts 11': 30,
  'Acts 12': 25,
  'Acts 13': 52,
  'Acts 14': 28,
  'Acts 15': 40,
  'Acts 16': 40,
  'Acts 17': 34,
  'Acts 18': 28,
  'Acts 19': 41,
  'Acts 20': 38,
  'Acts 21': 40,
  'Acts 22': 30,
  'Acts 23': 35,
  'Acts 24': 26,
  'Acts 25': 27,
  'Acts 26': 32,
  'Acts 27': 44,
  'Acts 28': 30,
  'Romans 1': 32,
  'Romans 2': 29,
  'Romans 3': 31,
  'Romans 4': 25,
  'Romans 5': 21,
  'Romans 6': 23,
  'Romans 7': 25,
  'Romans 8': 39,
  'Romans 9': 33,
  'Romans 10': 21,
  'Romans 11': 36,
  'Romans 12': 21,
  'Romans 13': 14,
  'Romans 14': 23,
  'Romans 15': 33,
  'Romans 16': 26,
  '1 Corinthians 1': 31,
  '1 Corinthians 2': 16,
  '1 Corinthians 3': 23,
  '1 Corinthians 4': 21,
  '1 Corinthians 5': 13,
  '1 Corinthians 6': 20,
  '1 Corinthians 7': 40,
  '1 Corinthians 8': 13,
  '1 Corinthians 9': 27,
  '1 Corinthians 10': 33,
  '1 Corinthians 11': 34,
  '1 Corinthians 12': 31,
  '1 Corinthians 13': 13,
  '1 Corinthians 14': 40,
  '1 Corinthians 15': 58,
  '1 Corinthians 16': 24,
  '2 Corinthians 1': 24,
  '2 Corinthians 2': 17,
  '2 Corinthians 3': 18,
  '2 Corinthians 4': 18,
  '2 Corinthians 5': 21,
  '2 Corinthians 6': 18,
  '2 Corinthians 7': 16,
  '2 Corinthians 8': 24,
  '2 Corinthians 9': 15,
  '2 Corinthians 10': 18,
  '2 Corinthians 11': 33,
  '2 Corinthians 12': 21,
  '2 Corinthians 13': 14,
  'Galatians 1': 24,
  'Galatians 2': 21,
  'Galatians 3': 29,
  'Galatians 4': 31,
  'Galatians 5': 26,
  'Galatians 6': 18,
  'Ephesians 1': 23,
  'Ephesians 2': 22,
  'Ephesians 3': 21,
  'Ephesians 4': 32,
  'Ephesians 5': 33,
  'Ephesians 6': 24,
  'Philippians 1': 30,
  'Philippians 2': 30,
  'Philippians 3': 21,
  'Philippians 4': 23,
  'Colossians 1': 29,
  'Colossians 2': 23,
  'Colossians 3': 25,
  'Colossians 4': 18,
  '1 Thessalonians 1': 10,
  '1 Thessalonians 2': 20,
  '1 Thessalonians 3': 13,
  '1 Thessalonians 4': 18,
  '1 Thessalonians 5': 28,
  '2 Thessalonians 1': 12,
  '2 Thessalonians 2': 17,
  '2 Thessalonians 3': 18,
  '1 Timothy 1': 20,
  '1 Timothy 2': 15,
  '1 Timothy 3': 16,
  '1 Timothy 4': 16,
  '1 Timothy 5': 25,
  '1 Timothy 6': 21,
  '2 Timothy 1': 18,
  '2 Timothy 2': 26,
  '2 Timothy 3': 17,
  '2 Timothy 4': 22,
  'Titus 1': 16,
  'Titus 2': 15,
  'Titus 3': 15,
  'Philemon 1': 25,
  'Hebrews 1': 14,
  'Hebrews 2': 18,
  'Hebrews 3': 19,
  'Hebrews 4': 16,
  'Hebrews 5': 14,
  'Hebrews 6': 20,
  'Hebrews 7': 28,
  'Hebrews 8': 13,
  'Hebrews 9': 28,
  'Hebrews 10': 39,
  'Hebrews 11': 40,
  'Hebrews 12': 29,
  'Hebrews 13': 25,
  'James 1': 27,
  'James 2': 26,
  'James 3': 18,
  'James 4': 17,
  'James 5': 20,
  '1 Peter 1': 25,
  '1 Peter 2': 25,
  '1 Peter 3': 22,
  '1 Peter 4': 19,
  '1 Peter 5': 14,
  '2 Peter 1': 21,
  '2 Peter 2': 22,
  '2 Peter 3': 18,
  '1 John 1': 10,
  '1 John 2': 29,
  '1 John 3': 24,
  '1 John 4': 21,
  '1 John 5': 21,
  '2 John 1': 13,
  '3 John 1': 15,
  'Jude 1': 25,
  'Revelation 1': 20,
  'Revelation 2': 29,
  'Revelation 3': 22,
  'Revelation 4': 11,
  'Revelation 5': 14,
  'Revelation 6': 17,
  'Revelation 7': 17,
  'Revelation 8': 13,
  'Revelation 9': 21,
  'Revelation 10': 11,
  'Revelation 11': 19,
  'Revelation 12': 17,
  'Revelation 13': 18,
  'Revelation 14': 20,
  'Revelation 15': 8,
  'Revelation 16': 21,
  'Revelation 17': 18,
  'Revelation 18': 24,
  'Revelation 19': 21,
  'Revelation 20': 15,
  'Revelation 21': 27,
  'Revelation 22': 21,
};


module.exports = {
  default: JWLLinkerPlugin,
};