const {
  Plugin,
  Editor,
  ItemView,
  Menu,
  Notice,
  MarkdownRenderChild,
  MarkdownRenderer,
  requestUrl,
  PluginSettingTab,
  Setting,
} = require('obsidian');

const DEFAULT_SETTINGS = {
  verseTemplate: '{title}\u2002“*{text}*”', // non-breaking space
  verseCalloutTemplate: '> [!verse] BIBLE — {title}\n> {text}\n',
  pubTemplate: '{title}\n“*{text}*”',
  pubCalloutTemplate: '> [!cite] PUB. — {title}\n> {text}\n',
  historySize: 20,
  boldInitialNum: true,
  citationLink: true,
  spaceAfterPunct: true,
  paraCount: 1,
  lang: 'English',
};

// Keep separate from OutputError to allow future i18n
const Lang = {
  name: 'JWL Linker',
  invalidScripture: '⚠️ This is not a valid scripture reference.',
  invalidUrl: '⚠️ This is not a valid wol.jw.org url.',
  onlineLookupFailed: '⚠️ Online scripture lookup failed. Try again.',
  noEditor: '⚠️ No active editor available.',
  noSelection: '⚠️ Nothing on cursor line or no selection.',
  noHistoryYet: 'No history to display.',
  noTitle: 'Title missing',
  loadingCitation: '⏳ Loading citation:',
  copiedHistoryMsg: 'History item copied to clipboard',
  helpIntro: 'This sidebar shows all the recent verses, paragraphs, and publications you have cited using the plugin.',
  helpCopy: 'Click any item above to copy it to the clipboard.',
  helpClear: 'Click here to clear the search history.',
  hideTip: 'Click to hide',
  help: 'Help',
  emptyPara: '*⟪ Empty paragraph ⟫*',
  /** @type {Object<string, string>} value: display text*/
  paragraphOptions: {
    1: '1',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
  },
  /** @type {Object<string, string>} value: display text*/
  historySize: {
    0: '0',
    10: 10,
    20: 20,
    30: 30,
    40: 40,
    50: 50,
    75: 75,
    100: 100,
  },
};

const Languages = {
  English: 'EN',
  German: 'DE',
  Dutch: 'NL',
  French: 'FR',
};

const Config = {
  jwlFinder: 'jwlibrary:///finder?',
  jwlLocale: '&wtlocale=E', // English only right now
  wolRoot: 'https://wol.jw.org/en/wol/d/', // d = direct
  wolPublications: 'https://wol.jw.org/en/wol/d/r1/lp-e/',
  wolLookup: 'https://wol.jw.org/en/wol/l/r1/lp-e?q=', // l = lookup
  webFinder: 'https://www.jw.org/finder?',
  urlParam: 'bible=',
  // [1] whole scripture match [2] plain text [3] book name [4] chapter/verse passages [5] already link
  scriptureRegex:
    /(('?)((?:[123][\u0020\u00A0]?)?(?:[\p{L}\p{M}\.]{2,}|song of solomon))((?: ?(?:\d{1,3}):(?:\d{1,3})(?:[-,] ?\d{1,3})*;?)+))(\]|<\/a>)?/gimu,
  scriptureNoChpRegex: /(('?)(obadiah|ob|phm|philemon|(?:2|3)(?: )?jo(?:hn)?|jud(?:e)?)(?: ?)(\d{1,2}))(\]|<\/a>)?/gim,
  scriptureNoVerseRegex: /(('?)((?:[123][\u0020\u00A0]?)?(?:[\p{L}\p{M}\.]{2,}|song of solomon))((?: ?(?:\d{1,3})(?![\d:]);?)+))(\]|<\/a>)?/gimu,
  wolLinkRegex: /(\[([^\[\]]*)\]\()?(https\:\/\/wol\.jw\.org[^\s\)]{2,})(\))?/gim,
  jworgLinkRegex: /(\[([^\[\]]*)\]\()?(https[^\s\)]+jw\.org[^\s\)]{2,})(\))?/gim,
  initialNumRegex: /^([\n\s]?)(\d{1,3}) /gim,
  delay: 3000,
};

// All the available commands provided by the plugin
const Cmd = {
  citeVerse: 'citeVerse',
  citeVerseCallout: 'citeVerseCallout',
  citeParagraph: 'citeParagraph',
  citeParagraphCallout: 'citeParagraphCallout',
  openSelectedinWOL: 'openSelectedInWOL',
  citePublicationLookup: 'citePublicationLookup',
  addLinkTitle: 'addLinkTitle',
  convertScriptureToJWLibrary: 'convertScriptureToJWLibrary',
  convertWebToJWLibrary: 'convertWebToJWLibrary',
  openScriptureInJWLibrary: 'openScriptureInJWLibrary',
};

const JWL_LINKER_VIEW = 'jwl-linker-view';

class JWLLinkerPlugin extends Plugin {
  constructor() {
    //// biome-ignore lint/style/noArguments:
    super(...arguments);
    /** @type {Object} */
    this.settings = {};
    /** @type {Menu} */
    this.menu = new Menu();
    this.menuClass = 'jwl-linker-plugin-menu-container';
  }

  async onload() {
    await this.loadSettings();

    /** @namespace */
    this.api = {
      getAllScriptureLinks: this._parseScriptureLinks,
      DisplayType: DisplayType,
    };

    // Load command palette
    for (const cmd of this.MenuCommands) {
      this.addCommand({
        id: cmd.id,
        name: cmd.text,
        icon: cmd.icon,
        editorCallback: cmd.fn,
      });
    }

    // Cache the populated menu
    this.menu = this.buildMenu();

    // Add the global Open JWL Menu command (for Mobile toolbar)
    this.addCommand({
      id: this.MenuName.id,
      name: this.MenuName.text,
      icon: this.MenuName.icon,
      editorCallback: (editor) => this.showMenu(editor),
    });

    this.addCommand({
      id: 'jwl-linker-open',
      name: 'Open sidebar',
      callback: this.activateView.bind(this),
    });

    // Add right-click submenu item in Editor (for Desktop)
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        menu.addItem((item) => {
          item.setTitle(this.MenuName.text).setIcon(this.MenuName.icon);
          const submenu = item.setSubmenu();
          this.buildMenu(submenu);
        });
      }),
    );

    this.registerView(JWL_LINKER_VIEW, (leaf) => new JWLLinkerView(leaf, this.settings));

    // KEY FEATURE
    // In READING Mode: Render scriptures as JWLibrary links
    this.registerMarkdownPostProcessor((element, context) => {
      context.addChild(new ScripturePostProcessor(element, this));
    });

    this.app.workspace.onLayoutReady(this.activateView.bind(this));

    this.addSettingTab(new JWLLinkerSettingTab(this.app, this));

    // biome-ignore lint: ⚠️
    console.log(
      `%c${this.manifest.name} ${this.manifest.version} loaded`,
      'background-color: purple; padding:4px; border-radius:4px',
    );
  }

  onunload() { }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(JWL_LINKER_VIEW).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false); // false => no split
      await leaf.setViewState({
        type: JWL_LINKER_VIEW,
        active: true,
      });
      await workspace.revealLeaf(leaf);
    }
  }

  /**
   * KEY FEATURE
   * Convert input to JW Library links,
   * Search entire input string for ...
   *   1. plain text scripture references
   *   2. jw.org Finder links | wol.jw.org links
   * Both are validated and return an error Notice on failure
   * Editing/Preview View only
   * @param {Editor} editor
   * @param {Cmd} command
   */
  linkToJWLibrary(editor, command) {
    const activeEditor = this.confirmEditor(editor);
    if (!activeEditor) return;
    const { selection } = this._getEditorSelection(activeEditor);
    if (selection) {
      let output;
      let changed;
      if (command === Cmd.convertScriptureToJWLibrary) {
        ({ output, changed } = this._convertScriptureToJWLibrary(selection, DisplayType.md));
      } else if (command === Cmd.convertWebToJWLibrary) {
        ({ output, changed } = this._convertWebToJWLibrary(selection));
      }
      if (changed) {
        activeEditor.replaceSelection(output);
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }
  }

  /**
   * Open the scripture under the caret in JWLibrary
   * Works only in Editing/Preview mode
   * @param {Editor} editor 
   */
  openInJWLibrary(editor) {
    const activeEditor = this.confirmEditor(editor);
    if (!activeEditor) return;
    const { selection, caret } = this._getEditorSelection(activeEditor, false);
    if (selection) {
      const { output, changed } = this._convertScriptureToJWLibrary(selection, DisplayType.open, caret);
      if (changed) {
        window.open(output);
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }
  }

  /**
   * Use the selected text, e.g. publication reference as a search in wol.jw.org
   */
  openSelectedInWOL(editor) {
    const activeEditor = this.confirmEditor(editor);
    if (!activeEditor) return;
    const { selection } = this._getEditorSelection(activeEditor, false);
    if (selection) {
      window.open(Config.wolLookup + selection);
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }
  }

  /**
   * KEY FEATURE
   * Editing/Preview View only:
   * Cite publication lookup reference, returns all pages in the reference, below
   * Cite scripture reference in full below or just a snippet inline, adds a JWL link
   * Cite paragraph or snippet from JW.Org Finder or WOL url,
   *    with correct publication navigation title
   * Add title only: an MD link with correct navigation title + url
   * @param {Editor} editor
   * @param {Cmd} command
   * @param {number} [pars="0"] *Number of paragraphs to cite (Use 0 for link only)
   */
  async insertCitation(editor, command, pars = 0) {
    /** @type {Notice} */
    let loadingNotice;
    const activeEditor = this.confirmEditor(editor);
    if (!activeEditor) return;
    let { selection, caret, line } = this._getEditorSelection(activeEditor);
    if (selection) {
      selection = selection.trim();
      loadingNotice = new Notice(`${Lang.loadingCitation} ${selection}`); // remain open until we complete
      const view = await this.getView();
      switch (command) {
        case Cmd.citeVerse:
        case Cmd.citeVerseCallout:
          // Convert Scripture reference into bible verse citation (+ JW Library MD URL*)
          this._fetchBibleCitation(selection, view, caret, command).then(replaceEditorSelection);
          break;
        case Cmd.citeParagraph:
        case Cmd.citeParagraphCallout:
        case Cmd.addLinkTitle:
          // Convert JW.Org Finder-type URL to a paragraph citation (+ JW Library MD URL*)
          this._fetchParagraphCitation(selection, view, caret, command, pars).then(replaceEditorSelection);
          break;
        case Cmd.citePublicationLookup:
          // Convert Publication lookup into a article citation
          this._fetchLookupCitation(selection, view).then(replaceEditorSelection);
          break;
      }
    } else {
      new Notice(Lang.noSelection, Config.delay);
    }

    function replaceEditorSelection(output) {
      // Any errors will be part of the result
      activeEditor.replaceSelection(output);
      // try to select the original reference, first line (helps user delete it quickly if needed)
      const last = activeEditor.getLine(line).length;
      activeEditor.setSelection({ line: line, ch: 0 }, { line: line, ch: last });
      loadingNotice.hide();
    }
  }

  /**
   * Check if there is an active editor, and attempt to return it
   * @param {Editor} editor
   * @returns {Editor}
   */
  confirmEditor(editor) {
    let activeEditor = editor;
    if (!activeEditor?.hasFocus()) {
      const view = this.app.workspace.getMostRecentLeaf().view;
      if (view) {
        activeEditor = view.editor;
      }
    }
    if (!activeEditor) {
      new Notice(Lang.noEditor, Config.delay);
    }
    return activeEditor;
  }

  /**
   * Get a valid view reference even if deferred, so that we can add to the history
   * Does not reveal the leaf as the user might be using a different one
   * @returns {View|null}
   */
  async getView() {
    const leaf = this.app.workspace.getLeavesOfType(JWL_LINKER_VIEW).first();
    if (leaf) {
      await leaf.loadIfDeferred(); // don't reveal in case user has another sidebar open
      if (leaf && leaf.view instanceof JWLLinkerView) {
        return leaf.view;
      }
    }
    return null;
  }

  /**
   * Show the dropdown menu just below the caret
   * @param {Editor} editor
   * @param {Menu} menu
   * @returns {void}
   */
  showMenu(editor) {
    // Is the menu already active?
    if (document.querySelector(`.menu${this.menuClass}`)) return;

    if (!editor || !editor.hasFocus()) {
      new Notice(Lang.noEditor, Config.delay);
      return;
    }
    const cursor = editor.getCursor('from');
    const offset = editor.posToOffset(cursor);
    const coords = editor.cm.coordsAtPos(offset);
    this.menu.showAtPosition({
      x: coords.right,
      y: coords.top + 20,
    });
  }

  /**
   * Prepare the dropdown menu. Each menu item calls its command counterpart
   * @param {*} submenu submenu instance of a parent menu; if empty create new menu
   * @returns New menu ready to use
   */
  buildMenu(submenu = undefined) {
    /** @type {Menu} */
    const menu = submenu ? submenu : new Menu();
    // this class is needed to identify if the menu is already open
    menu.dom.addClass(this.menuClass);
    // no title on submenus
    if (!submenu) {
      menu.addItem((item) => {
        item.setTitle(this.MenuName.title);
        item.setIcon(this.MenuName.icon);
        item.setIsLabel(true);
      });
      menu.addSeparator();
    }
    for (const cmd of this.MenuCommands) {
      menu.addItem((item) => {
        item.setTitle(cmd.text);
        item.setIcon(cmd.icon);
        item.onClick(() => this.app.commands.executeCommandById(`${this.manifest.id}:${cmd.id}`));
      });
      if (cmd.sep ?? null) menu.addSeparator();
    }
    // Select no. of paragraphs to cite
    menu.addItem((item) => {
      const titleEl = createDiv({ text: this.MenuParaCount.text });
      titleEl.createSpan({ text: this.settings.paraCount });
      item.setTitle(titleEl);
      item.setIcon(this.MenuParaCount.icon);
      const submenu = item.setSubmenu();
      for (const [key, value] of Object.entries(Lang.paragraphOptions)) {
        submenu.addItem((item) => {
          item.setTitle(value);
          item.setIcon('pilcrow');
          item.setChecked(Number(key) === this.settings.paraCount);
          item.onClick(() => {
            this.settings.paraCount = Number(value);
            this.saveSettings();
            // TODO keep menu open (complicated...)
          });
        });
      }
    });
    // Toggle citation link on/off
    menu.addItem((item) => {
      item.setTitle(this.MenuCitationLink.text);
      item.setIcon(this.MenuCitationLink.icon);
      item.setChecked(this.settings.citationLink);
      item.onClick(() => {
        this.settings.citationLink = !this.settings.citationLink;
        this.saveSettings();
      });
    });
    return menu;
  }

  MenuName = {
    id: 'openJWLLinkerMenu',
    text: 'JWL Linker',
    title: 'JWL Linker',
    icon: 'gem',
  };

  MenuCommands = [
    {
      id: Cmd.citeVerse,
      text: 'Cite verses',
      icon: 'whole-word',
      fn: (editor) => this.insertCitation(editor, Cmd.citeVerse),
    },
    {
      id: Cmd.citeVerseCallout,
      text: 'Cite verses as callout',
      icon: 'book-open',
      fn: (editor) => this.insertCitation(editor, Cmd.citeVerseCallout),
      sep: true,
    },
    {
      id: Cmd.citeParagraph,
      text: 'Cite jw.org url',
      icon: 'whole-word',
      fn: (editor) => this.insertCitation(editor, Cmd.citeParagraph, 1),
    },
    {
      id: `${Cmd.citeParagraphCallout}`,
      text: 'Cite jw.org url as callout',
      icon: 'lucide-panel-top-open',
      fn: (editor) => this.insertCitation(editor, Cmd.citeParagraphCallout, 1),
      sep: true,
    },
    {
      id: Cmd.citePublicationLookup,
      text: 'Cite publication lookup',
      icon: 'reading-glasses',
      fn: (editor) => this.insertCitation(editor, Cmd.citePublicationLookup),
    },
    {
      id: Cmd.openSelectedinWOL,
      text: 'Lookup selected text on WOL',
      icon: 'search',
      fn: (editor) => this.openSelectedInWOL(editor),
      sep: true,
    },
    {
      id: Cmd.addLinkTitle,
      text: 'Add title to jw.org url',
      icon: 'link',
      fn: (editor) => this.insertCitation(editor, Cmd.addLinkTitle),
    },
    {
      id: Cmd.convertScriptureToJWLibrary,
      text: 'Convert scriptures to JW Library',
      icon: 'library',
      fn: (editor) => this.linkToJWLibrary(editor, Cmd.convertScriptureToJWLibrary),
    },
    {
      id: Cmd.convertWebToJWLibrary,
      text: 'Convert jw.org url to JW Library',
      icon: 'library',
      fn: (editor) => this.linkToJWLibrary(editor, Cmd.convertWebToJWLibrary),
    },
    {
      id: Cmd.openScriptureInJWLibrary,
      text: 'Open scripture at caret in JW Library',
      icon: 'external-link',
      fn: (editor) => this.openInJWLibrary(editor),
      sep: true,
    },
  ];

  MenuParaCount = {
    text: 'No. of paragraphs to cite?',
    icon: 'pilcrow',
  };

  MenuCitationLink = {
    text: 'Link cited scripture?',
    icon: 'links-going-out',
  };

  /* 🛠️ INTERNAL FUNCTIONS */

  /**
   * In the active editor:
   * (1) the current selection if available, defaults to current line
   * (2) sets selection to current line and returns it
   * Assumes an editor is active!
   * @param {Editor} editor
   * @param {boolean} [setSelection=true] should we select the entire line in the editor?
   * @param {boolean} [entireLine=false] select and return entire line
   * @returns {{ string, number, number }} current selection, relative caret position, current line no.
   */
  _getEditorSelection(editor, setSelection = true, entireLine = false) {
    let selection;
    let caret;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    if (!entireLine && editor.somethingSelected()) {
      // either (1) current selection
      // No caret position when user has explicitly selected a section of text/verse
      // caret = cursor.ch + line.indexOf(selection);
      selection = editor.getSelection();
    } else {
      // or (2) current line (select entire line)
      const from = { line: cursor.line, ch: 0 };
      const to = { line: cursor.line, ch: line.length };
      selection = editor.getRange(from, to);
      if (setSelection) {
        editor.setSelection(from, to);
      }
      caret = cursor.ch;
    }
    return { selection, caret, line: cursor.line };
  }

  /**
   * Swaps all jw.org Finder-style and wol.jw.org urls in input text for JW Library app urls
   * @param {string} input
   * @return {{output: string, changed: boolean}} Updated text with swapped links, changed is true if at least one url changed
   */
  _convertWebToJWLibrary(input) {
    let output = input;
    let changed = false;
    const links = this._getLinksInText(input);
    for (const link of links) {
      const mdLink = `[${link.title}](${Config.jwlFinder}&docid=${link.docId}&par=${link.parId})`;
      output = output.replace(link.whole, mdLink);
      changed = true;
    }
    return { output, changed };
  }

  /**
   * Replaces ALL valid scripture references in input text with links
   * Result depends on DisplayType:
   * 1. JW Library MD links []()
   * 2. Href links
   * 3. Plain url
   * @param {string} input
   * @param {DisplayType} displayType
   * @return {{output: string, changed: boolean}}
   */
  _convertScriptureToJWLibrary(input, displayType, caret = undefined) {
    let output = input;
    let changed = false; // true if at least one scripture reference was recognised

    // HACK 🚧 references in headings and callouts break formatting...
    // Only accept text elements for now
    const isTextElem = !(input.startsWith('<h') || input.startsWith('<div data'));

    if (isTextElem) {
      /** @type {TReference} */
      for (const reference of this._parseScriptureLinks(input, displayType, this.settings.spaceAfterPunct, caret)) {
        if (!reference.isLinkAlready) {
          let referenceMarkup = '';
          /** @type {TPassage} */
          for (const passage of reference.passages) {
            let markup = passage.display;
            if (passage.link) {
              if (displayType === DisplayType.md) {
                markup = `[${passage.display}](${passage.link.jwlib})`;
              } else if (displayType === DisplayType.href) {
                markup = `<a href="${passage.link.jwlib}" title="${passage.link.jwlib}">${passage.display}</a>`; // make the target URL visible on hover
              } else if (displayType === DisplayType.open) {
                markup = passage.link.jwlib;
              }
            }
            referenceMarkup += passage.delimiter + markup;
          }
          if (displayType === DisplayType.open) {
            output = referenceMarkup;
          } else {
            output = output.replace(reference.original, referenceMarkup);
          }
          changed = true;
        }
      }
    }
    return { output, changed };
  }

  /**
   * Provides a sanitized, formatted bible citation on the line below the scripture reference
   * from jw.org html page, could include a JW Library link (see settings.citationLink)
   * @param {string} input Text containing the scripture (current line | current selection)
   * @param {View} view
   * @param {number} caret Current caret position in the input if no selection
   * @param {Cmd} command
   * @returns {string}
   */
  async _fetchBibleCitation(input, view, caret, command) {
    /** @type {TReferences} */
    const references = this._parseScriptureLinks(input, DisplayType.cite, this.settings.spaceAfterPunct, caret);
    if (references) {
      const output = [];
      output.push(input); // keep original input on first line
      for (const reference of references) {
        let dom = ''; // cache the dom if possible
        let prevChapter = '';
        for (const passage of reference.passages) {
          if (passage.error === OutputError.invalidScripture) {
            output.push(`${passage.displayFull} | ${Lang[OutputError.invalidScripture]}`);
            continue;
          }
          let title = passage.displayFull; // default
          if (this.settings.citationLink) {
            title = `[${title}](${passage.link.jwlib})`;
          }
          let verses = [];
          const cache = view.getFromHistory(passage.link.jwlib); // try the cache first
          if (cache) {
            verses = cache.content;
          } else {
            // reuse the previous dom if the chapter is the same
            if (passage.chapter !== prevChapter) {
              dom = await this._fetchDOM(passage.link.jworg);
              prevChapter = passage.chapter;
            }
            for (const id of passage.link.parIds) {
              const follows = verses.length > 0;
              let clean = this._getElementAsText(dom, `#v${id}`, TargetType.scripture, follows);
              clean = this._boldInitialNumber(clean);
              verses.push(clean);
            }
          }
          if (verses) {
            view.addToHistory(passage.link.jwlib, title, verses);
            view.showHistory();
            const text = verses.join('');
            let template = '';
            if (command === Cmd.citeVerse) {
              template = this.settings.verseTemplate;
            } else if (command === Cmd.citeVerseCallout) {
              template = this.settings.verseCalloutTemplate;
            }
            const citation = template.replace('{title}', title).replace('{text}', text);
            output.push(citation);
          } else {
            output.push(`${passage.displayFull} | ${Lang[OutputError.onlineLookupFailed]}`);
          }
        }
      }
      return output.join('\n');
    }
    return `${passage.displayFull} | ${Lang[OutputError.invalidScripture]}`;
  }

  /**
   * Inserts a sanitized, formatted paragraph citation below a valid wol.jw.org or finder url
   * @param {string} input text containing a jw.org/finder or wol.jw.org URL
   * @param {View} view
   * @param {number} caret position of the caret in the input
   * @param {Cmd} command full paragraph, inline or title only
   * @param {number} pars number of paragraphs to extract (1-3 right now)
   * @returns {string}
   */
  async _fetchParagraphCitation(input, view, caret, command, pars) {
    const match = this._getLinkAtCaret(input, caret);
    if (!match || !URL.canParse(match.url)) {
      return `${input} | ${Lang[OutputError.invalidUrl]}`;
    }
    let link = '';
    let content = [];
    const cache = view.getFromHistory(match.url, pars);
    if (cache) {
      link = cache.link;
      content = cache.content;
    } else {
      const dom = await this._fetchDOM(match.url);
      if (dom) {
        const pageTitle = this._getElementAsText(dom, 'title', TargetType.jwonline);
        const pageNav = this._getElementAsText(dom, '#publicationNavigation', TargetType.pubNav);
        const display = pageNav || pageTitle;
        link = `[${display}](${match.url})`;
        // Look for a wol/finder paragraph html #id
        // Title link only has no content
        if (command !== Cmd.addLinkTitle && match.parId) {
          for (let i = 0; i < pars; i++) {
            let par = this._getElementAsText(dom, `#p${match.parId}${i}`, TargetType.jwonline);
            if (par.trim() === '') {
              par = Lang.emptyPara;
            }
            content.push(par);
          }
        }
      }
    }
    if (link) {
      view.addToHistory(match.url, link, content);
      view.showHistory();
      let output = '';
      // replace the raw url to a full MD link
      if (command === Cmd.addLinkTitle) {
        output = input.replace(match.whole, link);
      } else {
        let template;
        let text = '';
        if (command === Cmd.citeParagraph) {
          template = this.settings.pubTemplate;
          text = content.join('');
        } else if (command === Cmd.citeParagraphCallout) {
          template = this.settings.pubCalloutTemplate;
          const glue = template[0] === '>' ? '\n>\n>' : '\n';
          text = content.join(glue);
          text = this._boldInitialNumber(text);
        }
        const citation = template.replace('{title}', link).replace('{text}', text);
        output = `${input}\n${citation}`;
      }
      return output;
    }
    return `${input} | ${Lang[OutputError.onlineLookupFailed]}`;
  }

  /**
   * Fetch wol.jw.org pub references (aka: 'publication reference lookup')
   * @param {string} input A valid WT style publication reference (copy of selection)
   * @param {View} view For history functions
   * @return {{string}, {boolean}, {OutputError}}
   */
  async _fetchLookupCitation(input, view) {
    // Convert WT pub lookup into WT search url syntax
    const lookupUrl = Config.wolLookup + encodeURIComponent(input).replace(/%20/g, '+');
    let link = '';
    let content = [];
    let text = '';
    const cache = view.getFromHistory(lookupUrl); // try the cache first
    if (cache) {
      link = cache.link;
      content = cache.content;
    } else {
      const dom = await this._fetchDOM(lookupUrl);
      if (dom) {
        const query = this._getElementAsText(dom, '.searchText', TargetType.jwonline);
        const display = this._getElementAsText(dom, '.cardLine1', TargetType.jwonline);
        link = `[${query} | ${display}](${lookupUrl})`; // (hard coded formatting)
        text = this._getElementAsText(dom, '.resultItems', TargetType.jwonline);
        content.push(text);
      }
    }
    if (link) {
      view.addToHistory(lookupUrl, link, content);
      view.showHistory();
      text = content.join('');
      text = this._boldInitialNumber(text);
      const template = this.settings.pubCalloutTemplate;
      // Check if template is actually a callout (user editable):
      // If so all lines need to be part of the callout syntax
      if (template[0] === '>') {
        text = text.replace(/^./gm, '>$&').substring(1);
      }
      const citation = template.replace('{title}', link).replace('{text}', text);
      // Insert the citation below the lookup query (hard coded formatting)
      const output = `${input}\n${citation}`;
      return output;
    }
    return Lang[OutputError.onlineLookupFailed];
  }

  /**
   * Fetch the entire DOM from a web page url
   * @param {string} url
   * @returns {Promise<Document|Null>}
   */
  async _fetchDOM(url) {
    try {
      const res = await requestUrl(url);
      if (res.status === 200) {
        return new DOMParser().parseFromString(res.text, 'text/html');
      }
    } catch (error) {
      //// biome-ignore lint/suspicious/noConsoleLog: ⚠️
      console.log(error);
    }
    return null;
  }

  /**
   * Make paragraph number bold, e.g. **4**
   * @param {*} text Verse or paragraph from WT online
   * @returns {string}
   */
  _boldInitialNumber(text) {
    if (this.settings.boldInitialNum) {
      return text.replace(Config.initialNumRegex, '$1**$2** ');
    }
    return text;
  }

  /**
   * Extract a specific HTML element from the DOM based on the selector
   * Convert to plain text and remove markup and unneeded character depending on type
   * (Try to keep all this messy html cleanup in one place)
   * Target types:
   * 1. scripture: from /finder?, need to add line breaks, remove &nbsp;
   * 2. jwonline: paragraph or article, linebreaks? etc.
   * 3. pubNav: the navigation title for a specific page location
   * Returns plain text string
   * @param {Document} dom  Entire DOM for a webpage url
   * @param {string} selector Valid html selector
   * @param {TargetType} type How the text should be converted, scriptures are more complicated
   * @param {boolean} [follows] Does this element come after previous sibling?
   * @return {string} Empty string implies that the selector failed
   */
  _getElementAsText(dom, selector, type, follows = false) {
    let text = '';
    const elem = dom.querySelector(selector) ?? null;
    if (elem) {
      if (type === TargetType.scripture) {
        // for scriptures we need access to the html first to find the WT formatting linebreaks
        let html = elem.innerHTML;
        const blocks = ['<span class="newblock"></span>', '<span class="parabreak"></span>'].map(
          (el) => new RegExp(el, 'gm'),
        );
        for (const el of blocks) {
          html = html.replace(el, '\n');
        }
        // Now remove html tags
        text = new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
        // Check for initial chapter numbers (always first element) and replace with 1
        if (elem.querySelector('.chapterNum')) {
          text = text.replace(Config.initialNumRegex, '1 ');
          // Is it block or inline verse styling for following verses?
          // Do we need to prepend a space/newline?
        } else if (follows) {
          const prependLF = elem.firstChild.hasClass('style-l') || elem.firstChild.hasClass('newblock');
          if (prependLF) {
            text = `\n${text}`;
          } else {
            text = ` ${text}`;
          }
        }
      } else {
        text = elem.textContent.trim();
      }
      if (type === TargetType.scripture || type === TargetType.jwonline) {
        text = text
          .replace(/[\u00A0\u202F]/gm, ' ') // &nbsp; &nnbsp; WT use them after initial numbers
          .replace(/([,.;])(\w)/gm, '$1 $2') // punctuation without a space after
          .replace(/[\+\*\#]/gm, '') // remove symbols used for annotations
          .replace(/\r\n/gm, '\n') // LF only
          .replace(/\n{2,4}/gm, '\n'); // reduce to single linebreaks only
      } else if (type === TargetType.pubNav) {
        text = text
          .replace(/\t/gm, ' ') // tabs
          .replace(/[\n\r]/gm, ' '); // no linebreaks
      }
      text = text.replace(/ {2,}/gim, ' '); // reduce multiple spaces to single
      return text;
    }
    return text;
  }

  /**
   * Looks for all JW web links in the input text
   * Either wol.jw.org/... or jw.org/finder... style links are accepted
   * Return an array of matching links or empty array
   * @param {string} input
   * @param {number?} caret
   * @returns {Array<TJWLink>}
   */
  _getLinksInText(input) {
    const links = [];
    const matches = input.matchAll(Config.jworgLinkRegex);
    for (const match of matches) {
      links.push(this._extractLinkParts(match));
    }
    return links;
  }

  /**
   * Looks for JW web links, returns the one nearest the caret
   * Either wol.jw.org/... or jw.org/finder... style links are accepted
   * Return the link nearest to the caret position, or null
   * @param {string} input
   * @param {number?} caret
   * @returns {TJWLink|null}
   */
  _getLinkAtCaret(input, caret) {
    let output = null;
    const matches = input.matchAll(Config.jworgLinkRegex);
    for (const match of matches) {
      const begin = match.index;
      const end = begin + match[0].length;
      if (caret >= begin && caret <= end) {
        output = this._extractLinkParts(match);
        break;
      }
    }
    return output;
  }

  /**
   * Try to match and return potential scripture references in the input string
   * If caret position is provided then match only the scripture nearest to the caret
   * Returns an array scripture references, one reference = passages within a bible book,
   *   each containing an array of passages, one passage = span of consecutive bible verses
   * @param {string} input                    Full input text
   * @param {DisplayType} displayType         How will this be displayed?
   * @param {boolean} spaceAfterPunct         Add a space after , or ; punctuation; for display purposes
   * @param {number|undefined} [caret]        Caret position 0+ (force single reference) | undefined (all references)
   * @returns {Array<TReference>|TReference}  Array list of references | reference (at caret)
   */
  _parseScriptureLinks(input, displayType, spaceAfterPunct = false, caret = undefined) {
    /** @type {array<TReference>} */
    const references = [];
    const spc = spaceAfterPunct ? ' ' : '';
    const ct = '|'; // used to indicate the caret location

    // Normal book chapter verse references
    const matchesNormal = input.matchAll(Config.scriptureRegex);
    // Small books with no chapter, e.g. phm, 2jo, 3jo, jude
    const matchesNoChp = input.matchAll(Config.scriptureNoChpRegex);
    // Chapter only references, e.g. John 3; Ex 16
    // Convert to array so that we can change value in-place
    const matchesNoVerse = input.matchAll(Config.scriptureNoVerseRegex).toArray();
    for (const match of matchesNoVerse) {
      // Add the dummy verse reference to chapter number (0 => link to verse 1, display no verse)
      match[4] = match[4].replace(/(\d{1,3})/, '$1:0');
    }
    const matches = [...matchesNormal, ...matchesNoChp, ...matchesNoVerse];

    let noChapter = false;
    // match[] => [1] whole scripture match [2] is plain text? [3] book name [4] chapter/verse passages [5] is already link?
    for (const match of matches) {
      let foundCaret = false;
      let original = match[1];
      let origPassages = match[4].toString();
      // Default to chapter 1
      if (!origPassages.includes(':')) {
        origPassages = `1:${origPassages}`;
        noChapter = true;
      }
      // remove the last semi-colon in a list of passages
      if (original.slice(-1) === ';') {
        original = original.slice(0, -1);
        origPassages = origPassages.slice(0, -1);
      }
      /** @type {TReference} */
      let reference = {
        original: original,
        book: match[3],
        passages: [],
        isPlainText: Boolean(match[2]), // ' => skip this verse, no link
        isLinkAlready: Boolean(match[5]), // ] or </a> at end => this is already a Wiki/URL link | ' before the verse to skip auto-linking
      };
      // add a sentinel character as a caret locator in the *original* scripture passage
      // NOTE: we cannot simply add it to the original reference as it would disrupt the regex match
      // makes it easy to find the caret once the reference has been split up during parsing
      const refBegin = match.index;
      const refLength = match[1].length;
      const bookLength = match[2].length + match[3].length; // plain text marker and book name length
      if (caret) {
        const caretBook = caret - refBegin; // caret relative to this reference
        if (caretBook < bookLength) {
          foundCaret = true; // found the caret in book name
        } else if (caretBook >= bookLength && caretBook <= refLength) {
          const caretPassage = caretBook - bookLength;
          // insert sentinnel character
          origPassages = `${origPassages.substring(0, caretPassage)}${ct}${origPassages.substring(caretPassage)}`;
        }
      }
      const rawPassages = origPassages.split(';');
      let chapterCnt = 0;
      for (const rawPassage of rawPassages) {
        let [chapter, verses] = rawPassage.split(':');
        chapter = chapter.trim();
        let verseCnt = 0;
        for (let rawVerse of joinConsecutiveVerses(verses.split(','))) {
          // look for the caret locator first, remove if found!
          if (chapter.includes(ct)) {
            foundCaret = true; // found caret in chapter
            chapter = chapter.replace(ct, '');
          } else if (rawVerse.includes(ct)) {
            foundCaret = true; // found caret in verse
            rawVerse = rawVerse.replace(ct, '');
          }

          // try to convert the verse into a span: first => last (inclusive)
          const verse = {};
          for (const delim of ['-', ',']) {
            if (rawVerse.includes(delim)) {
              const ab = rawVerse.trim().split(delim);
              verse.first = Number(ab[0]);
              verse.last = Number(ab[1]);
              if (verse.last < verse.first) {
                verse.last = verse.first;
              }
              verse.separator = delim;
              break;
            }
          }
          // must be a single verse
          let noVerse = false;
          if (!verse.first) {
            // Handle special case of chapter only references
            if (rawVerse === '0') {
              verse.first = 1;
              noVerse = true;
            } else {
              verse.first = Number(rawVerse);
            }
            verse.last = verse.first;
            verse.separator = '';
          }
          if (displayType === DisplayType.find) {
            verse.last = verse.first;
          }

          let delimiter = '';
          if (chapterCnt > 0 && verseCnt === 0) {
            delimiter = `;${spc}`;
          } else if (verseCnt > 0) {
            delimiter = `,${spc}`;
          }

          /** @type {PrefixType} */
          let prefixType = PrefixType.showNone;
          if (caret && foundCaret) {
            prefixType = PrefixType.showBookChapter;
          } else {
            if (chapterCnt === 0) {
              prefixType = PrefixType.showBookChapter;
            } else if (verseCnt === 0) {
              prefixType = PrefixType.showChapter;
            }
          }

          const passage = {
            prefixType: prefixType, // whether to add the book/chapter prefix
            delimiter: delimiter, // , or ;
            display: reference.book, // fallback: original book as entered by user
            chapter: chapter,
            verse: verse, // first, last, separator
            link: null,
            error: OutputError.none,
            noChapter: noChapter,
            noVerse: noVerse,
          };

          // Special case: if caret is explicitly defined then we ignore other matches,
          // we simply look for the one at the caret
          if (caret) {
            if (foundCaret) {
              reference.passages.push(passage);
              reference = validateReference(reference, displayType);
              references.push(reference);
              return references; // return immediately, no need to process further
            }
          } else {
            reference.passages.push(passage);
            // if 'find' type then return the first match immediately (always a single verse reference)
            if (displayType === DisplayType.find) {
              reference = validateReference(reference, displayType);
              return reference;
            }
          }
          verseCnt++;
        }
        chapterCnt++;
      }
      // only collect references if there is no caret!
      if (!caret) {
        reference = validateReference(reference, displayType);
        references.push(reference);
      }
    }
    return references ? references : null;

    /**
     * INTERNAL
     * Process all chap/verse passages in a scripture reference and returns:
     * 1. The valid, canonical display version (ps 5:10 => Psalms 5:10)
     * 2. The correct jw scripture ID for the url args, in JWLib and wol.jw.org versions
     * 3. An array of scripture IDs (one for each verse in a range)
     *    needed to fetch the verse citations [optional]
     * @param {import('main').TReference} reference Scripture reference (same book, many chapter/verse passages)
     * @param {DisplayType} displayType plain, md, url, cite, find
     * @returns {TReference}
     */
    function validateReference(reference, displayType) {
      const lang = Languages[DEFAULT_SETTINGS.lang]; // No user setting available for this yet

      // First question: is this a valid bible book?
      // *********************************
      // The abbreviation list has no spaces: e.g. 1kings 1ki matthew matt mt
      // so we remove all spaces from the reference
      // Also use (^| ) to avoid matching inside book names, e.g. eph in zepheniah
      let bookNum = 0;
      const bookRgx = new RegExp(`(^| )${reference.book.replace(/[\s\u00A0.]/g, '').toLowerCase()}`, 'm'); // no spaces, &nbsp; or .
      const bookMatch = Bible[lang].Abbreviation.findIndex((elem) => elem.search(bookRgx) !== -1);
      if (bookMatch !== -1) {
        reference.book = Bible[lang].Book[bookMatch].replaceAll(' ', '\u00A0'); // avoid page breaks in book name
        bookNum = bookMatch + 1;
      }

      // Now handle each chapter:verse(s) passage
      /** @type {TPassage} */
      for (const passage of reference.passages) {
        const first = passage.verse.first;
        const last = passage.verse.last;

        // Build a canonical bible scripture reference
        // *******************************************
        // NOTE: passage.display default is the original book text from user
        const chapter = passage.noChapter ? '' : `${passage.chapter}`;
        const bookChapter = `${reference.book} ${chapter}`;
        if (passage.prefixType === PrefixType.showBookChapter) {
          passage.display = bookChapter;
        } else if (passage.prefixType === PrefixType.showChapter) {
          passage.display = chapter;
        }
        let verseSpan;
        if (passage.noVerse) {
          verseSpan = '';
        } else {
          verseSpan = first + (last > first ? passage.verse.separator + last : '');
          if (!passage.noChapter) {
            verseSpan = `:${verseSpan}`;
          }
        }
        passage.display += verseSpan;
        passage.displayFull = bookChapter + verseSpan;

        // Add the hyperlinks
        // ******************
        // Does this chapter and verse range exist in this bible book? If so, create the link
        let link = {};
        const bcLookup = `${bookNum} ${passage.chapter}`;
        if (bcLookup in BibleDimensions && first <= BibleDimensions[bcLookup] && last <= BibleDimensions[bcLookup]) {
          /** @type {TLink} */
          link = {
            jwlib: '',
            jworg: '',
            parIds: [],
          };
          // Handle the verse link id
          // Format: e.g. Genesis 2:6
          // Book|Chapter|Verse
          //  01 |  002  | 006  = 01001006
          // Verse range = 01001006-01001010 e.g. Gen 2:6-10
          // 🔥IMPORTANT: with jw.org par ids the leading 0 is skipped!
          if (displayType !== DisplayType.plain || displayType !== DisplayType.find) {
            const bookChapId = bookNum.toString() + passage.chapter.toString().padStart(3, '0');
            let id = bookChapId + first.toString().padStart(3, '0');
            if (last > first) {
              id += `-${bookChapId}${last.toString().padStart(3, '0')}`;
            }
            // Seems that the Windows version of JWLibrary needs the locale to be set.
            link.jwlib = `${Config.jwlFinder}${Config.urlParam}${id}${Config.jwlLocale}`;

            // Finally, handle the (verse) par ids used to fetch the citation from jw.org
            if (displayType === DisplayType.cite) {
              link.jworg = `${Config.webFinder}${Config.urlParam}${id}`;
              for (let i = first; i <= last; i++) {
                link.parIds.push(bookChapId + i.toString().padStart(3, '0'));
              }
            }
          }
        } else {
          passage.error = OutputError.invalidScripture;
          link = null;
        }
        passage.link = link;
      }
      return reference;
    }

    /**
     * Find consecutive verses and consolidate them into one item
     * E.g. ['1', ' 2'] => ['1, 2']
     * @param {Array<string>} verses
     * @returns {Array<string>}
     */
    function joinConsecutiveVerses(verses) {
      const joined = [];
      const len = verses.length;
      for (let i = 0; i < len; i++) {
        const current = Number(verses[i].replace(ct, ''));
        const next = i < len - 1 ? Number(verses[i + 1].replace(ct, '')) : '';
        if (current === next - 1) {
          joined.push(`${verses[i]},${verses[i + 1]}`);
          i++;
        } else {
          joined.push(verses[i]);
        }
      }
      return joined;
    }
  }

  /**
   * Extracts all the parts of a JW web url
   * Either /finder? style or wol.jw.org style
   * Only accepts publication links, not verses or home page meeting workbook links
   * @param {string} match Regex match of a JW web url (wol or finder style)
   * @returns {TJWLink|null}
   */
  _extractLinkParts(match) {
    let url = match[3];
    let docId = '';
    let parId = '';
    if (url.startsWith(Config.wolRoot)) {
      const id = url.split('/').slice(-1)[0];
      if (id?.includes('#h')) {
        [docId, parId] = id.split('#h=', 2);
      } else {
        docId = id ?? '';
      }
    } else if (url.startsWith(Config.webFinder)) {
      const params = new URLSearchParams(url);
      docId = params.get('docid') ?? '';
      parId = params.get('par') ?? '';
      if (docId) {
        // switch the link style from finder to wol
        // so that we can scrape the paragraph content later if needed
        url = `${Config.wolPublications}${docId}#h=${parId}`;
      } else {
        return null;
      }
    } else {
      return null;
    }
    return {
      whole: match[0],
      title: match[1] ? match[2] : Lang.noTitle,
      url: url,
      docId: docId,
      parId: parId,
    };
  }

  /**
   * Returns the first X words from the sentence provided
   * @param {string} sentence
   * @param {number} count how many words; 0 = full verse
   * @returns {string} some or all words in sentence
   */
  _firstXWords(sentence, count) {
    if (count === 0) {
      return sentence;
    }
    const words = sentence.split(/\s/);
    if (words.length > count) {
      return `${words.slice(0, count).join(' ')} …`;
    }
    return sentence;
  }
}

class JWLLinkerView extends ItemView {
  constructor(leaf, settings) {
    super(leaf);
    this.settings = settings;
    this.historyEl;
    /** @type {Array<THistory>} */
    this.history = [];
    this.helpEl;
    this.expandHelpEl;
    this.helpExpanded = true;
  }

  getViewType() {
    return JWL_LINKER_VIEW;
  }

  getDisplayText() {
    return Lang.name;
  }

  getIcon() {
    return 'gem';
  }

  // Update View state from workspace.json
  async setState(state, result) {
    this.history = state.history ?? [];
    this.showHistory();
    await super.setState(state, result);
  }

  // Get current View state and save to workspace.json
  getState() {
    const state = super.getState();
    state.history = this.history; // update to the new state
    return state; // return the updated state, will be saved to workspace.json
  }

  async onOpen() {
    this.renderView();
  }

  async onClose() {
    this.unload();
  }

  renderView() {
    this.historyEl = this.contentEl.createDiv({ cls: 'jwl' });

    const detailsEl = createEl('details');
    detailsEl.createEl('summary', { text: Lang.help });
    detailsEl.createEl('p', { text: Lang.helpIntro });
    const detailEl = detailsEl.createEl('ul');
    detailEl.createEl('li', { text: Lang.helpCopy });
    const wipeEl = detailEl.createEl('li', {
      text: Lang.helpClear,
      cls: 'clear-history',
    });
    this.contentEl.append(detailsEl);

    this.showHistory;

    this.historyEl.onclick = (event) => {
      if (event.target.tagName === 'P') {
        const item = this.history[event.target.parentElement.parentElement.id];
        if (item) {
          const md = `${item.link}\n${item.content}`;
          navigator.clipboard.writeText(md);
          new Notice(Lang.copiedHistoryMsg, 2000);
        }
      }
    };

    wipeEl.onclick = () => {
      this.clearHistory();
    };
  }

  /* 🕒 HISTORY FUNCTIONS */

  showHistory() {
    this.historyEl.empty();
    if (this.history.length > 0) {
      const parent = new MarkdownRenderChild(this.containerEl);
      this.history.forEach((item, index) => {
        const itemEl = this.historyEl.createDiv({
          cls: 'item',
          attr: { id: index },
        });
        const linkEl = itemEl.createEl('p');
        const pars = item.content.length > 1 ? `\u{2002}¶\u{2008}${item.content.length}` : '';
        MarkdownRenderer.render(this.app, item.link + pars, linkEl, '/', parent);
        const textEl = itemEl.createEl('p');
        MarkdownRenderer.render(this.app, item.content.join(''), textEl, '/', parent);
      });
    } else {
      this.historyEl.createDiv({ cls: 'pane-empty', text: Lang.noHistoryYet });
    }
  }

  /**
   * Add a new history item to the top of the list
   * Note: This is part of the View class, as history is stored in the View's state
   * @param {string} url Primary key
   * @param {string} link The MD link
   * @param {Array} content The text content (array of strings)
   * @param {number} pars Treat 1-3 paragraphs as separate history items; lookup and verses anyway unique urls
   */
  addToHistory(url, link, content, pars = null) {
    /** @type {THistory} */
    const newItem = { key: url + (pars ?? ''), url, link, content };
    this.history = this.history.filter((item) => item.key !== newItem.key); // no duplicates
    this.history = [newItem, ...this.history]; // add to the top
    if (this.history.length > this.settings.maxHistory) {
      this.history = this.history.slice(0, this.settings.maxHistory);
    }
    this.app.workspace.requestSaveLayout(); // causes a state save via getState
  }

  /**
   * Grab the cache version of a lookup
   * Return the right number of paragraphs if there are enough else undefined
   * @param {string} url
   * @param {number} pars Paragraph count
   * @returns {THistory|undefined}
   */
  getFromHistory(url, pars = null) {
    const key = url + (pars ?? '');
    const cache = this.history.find((item) => key === item.key);
    return cache;
  }

  clearHistory() {
    this.history = [];
    this.app.workspace.requestSaveLayout();
    this.showHistory();
  }
}

/**
 * Reading View only:
 * Render all Scripture references in this HTML element as a JW Library links instead
 */
class ScripturePostProcessor extends MarkdownRenderChild {
  /**
   * @param {HTMLElement} containerEl
   * @param {Plugin} plugin
   */
  constructor(containerEl, plugin) {
    super(containerEl);
    this.plugin = plugin;
  }

  onload() {
    const html = this.containerEl.innerHTML.replaceAll('&nbsp;', '\u00A0');
    const { output, changed } = this.plugin._convertScriptureToJWLibrary(html, DisplayType.href);
    if (changed) {
      this.containerEl.innerHTML = output;
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
    const defaultTemplate = '{title}\n{text}\n';

    containerEl.empty();
    containerEl.addClass('jwl-settings');

    new Setting(containerEl)
      .setName('Display')
      .setDesc('You can use the following substitutions in the templates: {title}, {text}')
      .setHeading();

    new Setting(containerEl)
      .setName('Template for verse citation')
      .setDesc('Use this template when citing a span of Bible verses in normal text format')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.verseTemplate)
          .onChange(async (value) => {
            this.plugin.settings.verseTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Template for verse citation in callout')
      .setDesc('Use this template when citing a span of Bible verses using the callout format')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.verseCalloutTemplate)
          .onChange(async (value) => {
            this.plugin.settings.verseCalloutTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Template for publication citation')
      .setDesc('Use this template when citing from a publication in normal text formatting (jw.org or article lookup)')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.pubTemplate)
          .onChange(async (value) => {
            this.plugin.settings.lookupTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Template for publication citation in callout')
      .setDesc('Use this template when citing from a publication using the callout format (jw.org or article lookup)')
      .addTextArea((text) => {
        text
          .setPlaceholder(defaultTemplate)
          .setValue(this.plugin.settings.pubCalloutTemplate)
          .onChange(async (value) => {
            this.plugin.settings.pubCalloutTemplate = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('No. of history items')
      .setDesc('How many history items to show in the sidebar.')
      .addDropdown((drop) => {
        drop
          .addOptions(Lang.historySize)
          .setValue(this.plugin.settings.historySize)
          .onChange(async (value) => {
            this.plugin.settings.historySize = Number(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Initial numbers in bold')
      .setDesc('Apply bold markup to initial numbers in verses or paragraphs in the cited text.')
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.boldInitialNum).onChange(async (value) => {
          this.plugin.settings.boldInitialNum = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Link cited scripture')
      .setDesc('Link scripture reference to JW Library when citing verses.')
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.citationLink).onChange(async (value) => {
          this.plugin.settings.citationLink = value;
          await this.plugin.saveSettings();
        });
      });

    /* Reset section */

    new Setting(containerEl).setName('Reset').setDesc('This cannot be undone.').setHeading();

    new Setting(containerEl)
      .setName('Reset to default')
      .setDesc('Return all settings to their original defaults.')
      .addButton((btn) => {
        btn.setIcon('reset');
        btn.onClick(async () => {
          Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Clear history')
      .setDesc('Clear the list of items in the history sidebar.')
      .addButton((btn) => {
        btn.setIcon('reset');
        btn.onClick(async () => {
          this.plugin.view.clearHistory();
        });
      });
  }
}

const TargetType = {
  scripture: 'scripture',
  jwonline: 'jwonline',
  pubNav: 'pubNav',
};

const DisplayType = {
  href: 'href',   // HTML href link <a>...</a>
  md: 'md',       // Markdown link [](...)
  plain: 'plain', // Plain text: no link, proper case, expanded abbreviations
  cite: 'cite',   // Fetch and insert the full verse text
  find: 'find',   // For use in a search/find box, first result only
  open: 'open',   // Raw url path
};

const PrefixType = {
  showNone: 'showNone',
  showChapter: 'showChapter',
  showBookChapter: 'showBookChapter',
  showBookVerse: 'showBookVerse',
};

const OutputError = {
  none: 'none',
  invalidScripture: 'invalidScripture',
  invalidUrl: 'invalidUrl',
  onlineLookupFailed: 'onlineLookupFailed',
};

const Bible = {
  EN: {
    // Canonical bible book names, as displayed
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
    // abbr variations, no spaces allowed
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
      'psalms ps psa psalm',
      'proverbs pr pro prov',
      'ecclesiastes ec ecc eccl',
      'songofsolomon canticles ca',
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

// metadata for chapter and verse count per bible book
const BibleDimensions = {
  '1 1': 31,  // Genesis
  '1 2': 25,  // Genesis
  '1 3': 24,  // Genesis
  '1 4': 26,  // Genesis
  '1 5': 32,  // Genesis
  '1 6': 22,  // Genesis
  '1 7': 24,  // Genesis
  '1 8': 22,  // Genesis
  '1 9': 29,  // Genesis
  '1 10': 32,  // Genesis
  '1 11': 32,  // Genesis
  '1 12': 20,  // Genesis
  '1 13': 18,  // Genesis
  '1 14': 24,  // Genesis
  '1 15': 21,  // Genesis
  '1 16': 16,  // Genesis
  '1 17': 27,  // Genesis
  '1 18': 33,  // Genesis
  '1 19': 38,  // Genesis
  '1 20': 18,  // Genesis
  '1 21': 34,  // Genesis
  '1 22': 24,  // Genesis
  '1 23': 20,  // Genesis
  '1 24': 67,  // Genesis
  '1 25': 34,  // Genesis
  '1 26': 35,  // Genesis
  '1 27': 46,  // Genesis
  '1 28': 22,  // Genesis
  '1 29': 35,  // Genesis
  '1 30': 43,  // Genesis
  '1 31': 55,  // Genesis
  '1 32': 32,  // Genesis
  '1 33': 20,  // Genesis
  '1 34': 31,  // Genesis
  '1 35': 29,  // Genesis
  '1 36': 43,  // Genesis
  '1 37': 36,  // Genesis
  '1 38': 30,  // Genesis
  '1 39': 23,  // Genesis
  '1 40': 23,  // Genesis
  '1 41': 57,  // Genesis
  '1 42': 38,  // Genesis
  '1 43': 34,  // Genesis
  '1 44': 34,  // Genesis
  '1 45': 28,  // Genesis
  '1 46': 34,  // Genesis
  '1 47': 31,  // Genesis
  '1 48': 22,  // Genesis
  '1 49': 33,  // Genesis
  '1 50': 26,  // Genesis
  '2 1': 22,  // Exodus
  '2 2': 25,  // Exodus
  '2 3': 22,  // Exodus
  '2 4': 31,  // Exodus
  '2 5': 23,  // Exodus
  '2 6': 30,  // Exodus
  '2 7': 25,  // Exodus
  '2 8': 32,  // Exodus
  '2 9': 35,  // Exodus
  '2 10': 29,  // Exodus
  '2 11': 10,  // Exodus
  '2 12': 51,  // Exodus
  '2 13': 22,  // Exodus
  '2 14': 31,  // Exodus
  '2 15': 27,  // Exodus
  '2 16': 36,  // Exodus
  '2 17': 16,  // Exodus
  '2 18': 27,  // Exodus
  '2 19': 25,  // Exodus
  '2 20': 26,  // Exodus
  '2 21': 36,  // Exodus
  '2 22': 31,  // Exodus
  '2 23': 33,  // Exodus
  '2 24': 18,  // Exodus
  '2 25': 40,  // Exodus
  '2 26': 37,  // Exodus
  '2 27': 21,  // Exodus
  '2 28': 43,  // Exodus
  '2 29': 46,  // Exodus
  '2 30': 38,  // Exodus
  '2 31': 18,  // Exodus
  '2 32': 35,  // Exodus
  '2 33': 23,  // Exodus
  '2 34': 35,  // Exodus
  '2 35': 35,  // Exodus
  '2 36': 38,  // Exodus
  '2 37': 29,  // Exodus
  '2 38': 31,  // Exodus
  '2 39': 43,  // Exodus
  '2 40': 38,  // Exodus
  '3 1': 17,  // Leviticus
  '3 2': 16,  // Leviticus
  '3 3': 17,  // Leviticus
  '3 4': 35,  // Leviticus
  '3 5': 19,  // Leviticus
  '3 6': 30,  // Leviticus
  '3 7': 38,  // Leviticus
  '3 8': 36,  // Leviticus
  '3 9': 24,  // Leviticus
  '3 10': 20,  // Leviticus
  '3 11': 47,  // Leviticus
  '3 12': 8,  // Leviticus
  '3 13': 59,  // Leviticus
  '3 14': 57,  // Leviticus
  '3 15': 33,  // Leviticus
  '3 16': 34,  // Leviticus
  '3 17': 16,  // Leviticus
  '3 18': 30,  // Leviticus
  '3 19': 37,  // Leviticus
  '3 20': 27,  // Leviticus
  '3 21': 24,  // Leviticus
  '3 22': 33,  // Leviticus
  '3 23': 44,  // Leviticus
  '3 24': 23,  // Leviticus
  '3 25': 55,  // Leviticus
  '3 26': 46,  // Leviticus
  '3 27': 34,  // Leviticus
  '4 1': 54,  // Numbers
  '4 2': 34,  // Numbers
  '4 3': 51,  // Numbers
  '4 4': 49,  // Numbers
  '4 5': 31,  // Numbers
  '4 6': 27,  // Numbers
  '4 7': 89,  // Numbers
  '4 8': 26,  // Numbers
  '4 9': 23,  // Numbers
  '4 10': 36,  // Numbers
  '4 11': 35,  // Numbers
  '4 12': 16,  // Numbers
  '4 13': 33,  // Numbers
  '4 14': 45,  // Numbers
  '4 15': 41,  // Numbers
  '4 16': 50,  // Numbers
  '4 17': 13,  // Numbers
  '4 18': 32,  // Numbers
  '4 19': 22,  // Numbers
  '4 20': 29,  // Numbers
  '4 21': 35,  // Numbers
  '4 22': 41,  // Numbers
  '4 23': 30,  // Numbers
  '4 24': 25,  // Numbers
  '4 25': 18,  // Numbers
  '4 26': 65,  // Numbers
  '4 27': 23,  // Numbers
  '4 28': 31,  // Numbers
  '4 29': 40,  // Numbers
  '4 30': 16,  // Numbers
  '4 31': 54,  // Numbers
  '4 32': 42,  // Numbers
  '4 33': 56,  // Numbers
  '4 34': 29,  // Numbers
  '4 35': 34,  // Numbers
  '4 36': 13,  // Numbers
  '5 1': 46,  // Deuteronomy
  '5 2': 37,  // Deuteronomy
  '5 3': 29,  // Deuteronomy
  '5 4': 49,  // Deuteronomy
  '5 5': 33,  // Deuteronomy
  '5 6': 25,  // Deuteronomy
  '5 7': 26,  // Deuteronomy
  '5 8': 20,  // Deuteronomy
  '5 9': 29,  // Deuteronomy
  '5 10': 22,  // Deuteronomy
  '5 11': 32,  // Deuteronomy
  '5 12': 32,  // Deuteronomy
  '5 13': 18,  // Deuteronomy
  '5 14': 29,  // Deuteronomy
  '5 15': 23,  // Deuteronomy
  '5 16': 22,  // Deuteronomy
  '5 17': 20,  // Deuteronomy
  '5 18': 22,  // Deuteronomy
  '5 19': 21,  // Deuteronomy
  '5 20': 20,  // Deuteronomy
  '5 21': 23,  // Deuteronomy
  '5 22': 30,  // Deuteronomy
  '5 23': 25,  // Deuteronomy
  '5 24': 22,  // Deuteronomy
  '5 25': 19,  // Deuteronomy
  '5 26': 19,  // Deuteronomy
  '5 27': 26,  // Deuteronomy
  '5 28': 68,  // Deuteronomy
  '5 29': 29,  // Deuteronomy
  '5 30': 20,  // Deuteronomy
  '5 31': 30,  // Deuteronomy
  '5 32': 52,  // Deuteronomy
  '5 33': 29,  // Deuteronomy
  '5 34': 12,  // Deuteronomy
  '6 1': 18,  // Joshua
  '6 2': 24,  // Joshua
  '6 3': 17,  // Joshua
  '6 4': 24,  // Joshua
  '6 5': 15,  // Joshua
  '6 6': 27,  // Joshua
  '6 7': 26,  // Joshua
  '6 8': 35,  // Joshua
  '6 9': 27,  // Joshua
  '6 10': 43,  // Joshua
  '6 11': 23,  // Joshua
  '6 12': 24,  // Joshua
  '6 13': 33,  // Joshua
  '6 14': 15,  // Joshua
  '6 15': 63,  // Joshua
  '6 16': 10,  // Joshua
  '6 17': 18,  // Joshua
  '6 18': 28,  // Joshua
  '6 19': 51,  // Joshua
  '6 20': 9,  // Joshua
  '6 21': 45,  // Joshua
  '6 22': 34,  // Joshua
  '6 23': 16,  // Joshua
  '6 24': 33,  // Joshua
  '7 1': 36,  // Judges
  '7 2': 23,  // Judges
  '7 3': 31,  // Judges
  '7 4': 24,  // Judges
  '7 5': 31,  // Judges
  '7 6': 40,  // Judges
  '7 7': 25,  // Judges
  '7 8': 35,  // Judges
  '7 9': 57,  // Judges
  '7 10': 18,  // Judges
  '7 11': 40,  // Judges
  '7 12': 15,  // Judges
  '7 13': 25,  // Judges
  '7 14': 20,  // Judges
  '7 15': 20,  // Judges
  '7 16': 31,  // Judges
  '7 17': 13,  // Judges
  '7 18': 31,  // Judges
  '7 19': 30,  // Judges
  '7 20': 48,  // Judges
  '7 21': 25,  // Judges
  '8 1': 22,  // Ruth
  '8 2': 23,  // Ruth
  '8 3': 18,  // Ruth
  '8 4': 22,  // Ruth
  '9 1': 28,  // 1 Samuel
  '9 2': 36,  // 1 Samuel
  '9 3': 21,  // 1 Samuel
  '9 4': 22,  // 1 Samuel
  '9 5': 12,  // 1 Samuel
  '9 6': 21,  // 1 Samuel
  '9 7': 17,  // 1 Samuel
  '9 8': 22,  // 1 Samuel
  '9 9': 27,  // 1 Samuel
  '9 10': 27,  // 1 Samuel
  '9 11': 15,  // 1 Samuel
  '9 12': 25,  // 1 Samuel
  '9 13': 23,  // 1 Samuel
  '9 14': 52,  // 1 Samuel
  '9 15': 35,  // 1 Samuel
  '9 16': 23,  // 1 Samuel
  '9 17': 58,  // 1 Samuel
  '9 18': 30,  // 1 Samuel
  '9 19': 24,  // 1 Samuel
  '9 20': 42,  // 1 Samuel
  '9 21': 15,  // 1 Samuel
  '9 22': 23,  // 1 Samuel
  '9 23': 29,  // 1 Samuel
  '9 24': 22,  // 1 Samuel
  '9 25': 44,  // 1 Samuel
  '9 26': 25,  // 1 Samuel
  '9 27': 12,  // 1 Samuel
  '9 28': 25,  // 1 Samuel
  '9 29': 11,  // 1 Samuel
  '9 30': 31,  // 1 Samuel
  '9 31': 13,  // 1 Samuel
  '10 1': 27,  // 2 Samuel
  '10 2': 32,  // 2 Samuel
  '10 3': 39,  // 2 Samuel
  '10 4': 12,  // 2 Samuel
  '10 5': 25,  // 2 Samuel
  '10 6': 23,  // 2 Samuel
  '10 7': 29,  // 2 Samuel
  '10 8': 18,  // 2 Samuel
  '10 9': 13,  // 2 Samuel
  '10 10': 19,  // 2 Samuel
  '10 11': 27,  // 2 Samuel
  '10 12': 31,  // 2 Samuel
  '10 13': 39,  // 2 Samuel
  '10 14': 33,  // 2 Samuel
  '10 15': 37,  // 2 Samuel
  '10 16': 23,  // 2 Samuel
  '10 17': 29,  // 2 Samuel
  '10 18': 33,  // 2 Samuel
  '10 19': 43,  // 2 Samuel
  '10 20': 26,  // 2 Samuel
  '10 21': 22,  // 2 Samuel
  '10 22': 51,  // 2 Samuel
  '10 23': 39,  // 2 Samuel
  '10 24': 25,  // 2 Samuel
  '11 1': 53,  // 1 Kings
  '11 2': 46,  // 1 Kings
  '11 3': 28,  // 1 Kings
  '11 4': 34,  // 1 Kings
  '11 5': 18,  // 1 Kings
  '11 6': 38,  // 1 Kings
  '11 7': 51,  // 1 Kings
  '11 8': 66,  // 1 Kings
  '11 9': 28,  // 1 Kings
  '11 10': 29,  // 1 Kings
  '11 11': 43,  // 1 Kings
  '11 12': 33,  // 1 Kings
  '11 13': 34,  // 1 Kings
  '11 14': 31,  // 1 Kings
  '11 15': 34,  // 1 Kings
  '11 16': 34,  // 1 Kings
  '11 17': 24,  // 1 Kings
  '11 18': 46,  // 1 Kings
  '11 19': 21,  // 1 Kings
  '11 20': 43,  // 1 Kings
  '11 21': 29,  // 1 Kings
  '11 22': 53,  // 1 Kings
  '12 1': 18,  // 2 Kings
  '12 2': 25,  // 2 Kings
  '12 3': 27,  // 2 Kings
  '12 4': 44,  // 2 Kings
  '12 5': 27,  // 2 Kings
  '12 6': 33,  // 2 Kings
  '12 7': 20,  // 2 Kings
  '12 8': 29,  // 2 Kings
  '12 9': 37,  // 2 Kings
  '12 10': 36,  // 2 Kings
  '12 11': 21,  // 2 Kings
  '12 12': 21,  // 2 Kings
  '12 13': 25,  // 2 Kings
  '12 14': 29,  // 2 Kings
  '12 15': 38,  // 2 Kings
  '12 16': 20,  // 2 Kings
  '12 17': 41,  // 2 Kings
  '12 18': 37,  // 2 Kings
  '12 19': 37,  // 2 Kings
  '12 20': 21,  // 2 Kings
  '12 21': 26,  // 2 Kings
  '12 22': 20,  // 2 Kings
  '12 23': 37,  // 2 Kings
  '12 24': 20,  // 2 Kings
  '12 25': 30,  // 2 Kings
  '13 1': 54,  // 1 Chronicles
  '13 2': 55,  // 1 Chronicles
  '13 3': 24,  // 1 Chronicles
  '13 4': 43,  // 1 Chronicles
  '13 5': 26,  // 1 Chronicles
  '13 6': 81,  // 1 Chronicles
  '13 7': 40,  // 1 Chronicles
  '13 8': 40,  // 1 Chronicles
  '13 9': 44,  // 1 Chronicles
  '13 10': 14,  // 1 Chronicles
  '13 11': 47,  // 1 Chronicles
  '13 12': 40,  // 1 Chronicles
  '13 13': 14,  // 1 Chronicles
  '13 14': 17,  // 1 Chronicles
  '13 15': 29,  // 1 Chronicles
  '13 16': 43,  // 1 Chronicles
  '13 17': 27,  // 1 Chronicles
  '13 18': 17,  // 1 Chronicles
  '13 19': 19,  // 1 Chronicles
  '13 20': 8,  // 1 Chronicles
  '13 21': 30,  // 1 Chronicles
  '13 22': 19,  // 1 Chronicles
  '13 23': 32,  // 1 Chronicles
  '13 24': 31,  // 1 Chronicles
  '13 25': 31,  // 1 Chronicles
  '13 26': 32,  // 1 Chronicles
  '13 27': 34,  // 1 Chronicles
  '13 28': 21,  // 1 Chronicles
  '13 29': 30,  // 1 Chronicles
  '14 1': 17,  // 2 Chronicles
  '14 2': 18,  // 2 Chronicles
  '14 3': 17,  // 2 Chronicles
  '14 4': 22,  // 2 Chronicles
  '14 5': 14,  // 2 Chronicles
  '14 6': 42,  // 2 Chronicles
  '14 7': 22,  // 2 Chronicles
  '14 8': 18,  // 2 Chronicles
  '14 9': 31,  // 2 Chronicles
  '14 10': 19,  // 2 Chronicles
  '14 11': 23,  // 2 Chronicles
  '14 12': 16,  // 2 Chronicles
  '14 13': 22,  // 2 Chronicles
  '14 14': 15,  // 2 Chronicles
  '14 15': 19,  // 2 Chronicles
  '14 16': 14,  // 2 Chronicles
  '14 17': 19,  // 2 Chronicles
  '14 18': 34,  // 2 Chronicles
  '14 19': 11,  // 2 Chronicles
  '14 20': 37,  // 2 Chronicles
  '14 21': 20,  // 2 Chronicles
  '14 22': 12,  // 2 Chronicles
  '14 23': 21,  // 2 Chronicles
  '14 24': 27,  // 2 Chronicles
  '14 25': 28,  // 2 Chronicles
  '14 26': 23,  // 2 Chronicles
  '14 27': 9,  // 2 Chronicles
  '14 28': 27,  // 2 Chronicles
  '14 29': 36,  // 2 Chronicles
  '14 30': 27,  // 2 Chronicles
  '14 31': 21,  // 2 Chronicles
  '14 32': 33,  // 2 Chronicles
  '14 33': 25,  // 2 Chronicles
  '14 34': 33,  // 2 Chronicles
  '14 35': 27,  // 2 Chronicles
  '14 36': 23,  // 2 Chronicles
  '15 1': 11,  // Ezra
  '15 2': 70,  // Ezra
  '15 3': 13,  // Ezra
  '15 4': 24,  // Ezra
  '15 5': 17,  // Ezra
  '15 6': 22,  // Ezra
  '15 7': 28,  // Ezra
  '15 8': 36,  // Ezra
  '15 9': 15,  // Ezra
  '15 10': 44,  // Ezra
  '16 1': 11,  // Nehemiah
  '16 2': 20,  // Nehemiah
  '16 3': 32,  // Nehemiah
  '16 4': 23,  // Nehemiah
  '16 5': 19,  // Nehemiah
  '16 6': 19,  // Nehemiah
  '16 7': 73,  // Nehemiah
  '16 8': 18,  // Nehemiah
  '16 9': 38,  // Nehemiah
  '16 10': 39,  // Nehemiah
  '16 11': 36,  // Nehemiah
  '16 12': 47,  // Nehemiah
  '16 13': 31,  // Nehemiah
  '17 1': 22,  // Esther
  '17 2': 23,  // Esther
  '17 3': 15,  // Esther
  '17 4': 17,  // Esther
  '17 5': 14,  // Esther
  '17 6': 14,  // Esther
  '17 7': 10,  // Esther
  '17 8': 17,  // Esther
  '17 9': 32,  // Esther
  '17 10': 3,  // Esther
  '18 1': 22,  // Job
  '18 2': 13,  // Job
  '18 3': 26,  // Job
  '18 4': 21,  // Job
  '18 5': 27,  // Job
  '18 6': 30,  // Job
  '18 7': 21,  // Job
  '18 8': 22,  // Job
  '18 9': 35,  // Job
  '18 10': 22,  // Job
  '18 11': 20,  // Job
  '18 12': 25,  // Job
  '18 13': 28,  // Job
  '18 14': 22,  // Job
  '18 15': 35,  // Job
  '18 16': 22,  // Job
  '18 17': 16,  // Job
  '18 18': 21,  // Job
  '18 19': 29,  // Job
  '18 20': 29,  // Job
  '18 21': 34,  // Job
  '18 22': 30,  // Job
  '18 23': 17,  // Job
  '18 24': 25,  // Job
  '18 25': 6,  // Job
  '18 26': 14,  // Job
  '18 27': 23,  // Job
  '18 28': 28,  // Job
  '18 29': 25,  // Job
  '18 30': 31,  // Job
  '18 31': 40,  // Job
  '18 32': 22,  // Job
  '18 33': 33,  // Job
  '18 34': 37,  // Job
  '18 35': 16,  // Job
  '18 36': 33,  // Job
  '18 37': 24,  // Job
  '18 38': 41,  // Job
  '18 39': 30,  // Job
  '18 40': 24,  // Job
  '18 41': 34,  // Job
  '18 42': 17,  // Job
  '19 1': 6,  // Psalms
  '19 2': 12,  // Psalms
  '19 3': 8,  // Psalms
  '19 4': 8,  // Psalms
  '19 5': 12,  // Psalms
  '19 6': 10,  // Psalms
  '19 7': 17,  // Psalms
  '19 8': 9,  // Psalms
  '19 9': 20,  // Psalms
  '19 10': 18,  // Psalms
  '19 11': 7,  // Psalms
  '19 12': 8,  // Psalms
  '19 13': 6,  // Psalms
  '19 14': 7,  // Psalms
  '19 15': 5,  // Psalms
  '19 16': 11,  // Psalms
  '19 17': 15,  // Psalms
  '19 18': 50,  // Psalms
  '19 19': 14,  // Psalms
  '19 20': 9,  // Psalms
  '19 21': 13,  // Psalms
  '19 22': 31,  // Psalms
  '19 23': 6,  // Psalms
  '19 24': 10,  // Psalms
  '19 25': 22,  // Psalms
  '19 26': 12,  // Psalms
  '19 27': 14,  // Psalms
  '19 28': 9,  // Psalms
  '19 29': 11,  // Psalms
  '19 30': 12,  // Psalms
  '19 31': 24,  // Psalms
  '19 32': 11,  // Psalms
  '19 33': 22,  // Psalms
  '19 34': 22,  // Psalms
  '19 35': 28,  // Psalms
  '19 36': 12,  // Psalms
  '19 37': 40,  // Psalms
  '19 38': 22,  // Psalms
  '19 39': 13,  // Psalms
  '19 40': 17,  // Psalms
  '19 41': 13,  // Psalms
  '19 42': 11,  // Psalms
  '19 43': 5,  // Psalms
  '19 44': 26,  // Psalms
  '19 45': 17,  // Psalms
  '19 46': 11,  // Psalms
  '19 47': 9,  // Psalms
  '19 48': 14,  // Psalms
  '19 49': 20,  // Psalms
  '19 50': 23,  // Psalms
  '19 51': 19,  // Psalms
  '19 52': 9,  // Psalms
  '19 53': 6,  // Psalms
  '19 54': 7,  // Psalms
  '19 55': 23,  // Psalms
  '19 56': 13,  // Psalms
  '19 57': 11,  // Psalms
  '19 58': 11,  // Psalms
  '19 59': 17,  // Psalms
  '19 60': 12,  // Psalms
  '19 61': 8,  // Psalms
  '19 62': 12,  // Psalms
  '19 63': 11,  // Psalms
  '19 64': 10,  // Psalms
  '19 65': 13,  // Psalms
  '19 66': 20,  // Psalms
  '19 67': 7,  // Psalms
  '19 68': 35,  // Psalms
  '19 69': 36,  // Psalms
  '19 70': 5,  // Psalms
  '19 71': 24,  // Psalms
  '19 72': 20,  // Psalms
  '19 73': 28,  // Psalms
  '19 74': 23,  // Psalms
  '19 75': 10,  // Psalms
  '19 76': 12,  // Psalms
  '19 77': 20,  // Psalms
  '19 78': 72,  // Psalms
  '19 79': 13,  // Psalms
  '19 80': 19,  // Psalms
  '19 81': 16,  // Psalms
  '19 82': 8,  // Psalms
  '19 83': 18,  // Psalms
  '19 84': 12,  // Psalms
  '19 85': 13,  // Psalms
  '19 86': 17,  // Psalms
  '19 87': 7,  // Psalms
  '19 88': 18,  // Psalms
  '19 89': 52,  // Psalms
  '19 90': 17,  // Psalms
  '19 91': 16,  // Psalms
  '19 92': 15,  // Psalms
  '19 93': 5,  // Psalms
  '19 94': 23,  // Psalms
  '19 95': 11,  // Psalms
  '19 96': 13,  // Psalms
  '19 97': 12,  // Psalms
  '19 98': 9,  // Psalms
  '19 99': 9,  // Psalms
  '19 100': 5,  // Psalms
  '19 101': 8,  // Psalms
  '19 102': 28,  // Psalms
  '19 103': 22,  // Psalms
  '19 104': 35,  // Psalms
  '19 105': 45,  // Psalms
  '19 106': 48,  // Psalms
  '19 107': 43,  // Psalms
  '19 108': 13,  // Psalms
  '19 109': 31,  // Psalms
  '19 110': 7,  // Psalms
  '19 111': 10,  // Psalms
  '19 112': 10,  // Psalms
  '19 113': 9,  // Psalms
  '19 114': 8,  // Psalms
  '19 115': 18,  // Psalms
  '19 116': 19,  // Psalms
  '19 117': 2,  // Psalms
  '19 118': 29,  // Psalms
  '19 119': 176,  // Psalms
  '19 120': 7,  // Psalms
  '19 121': 8,  // Psalms
  '19 122': 9,  // Psalms
  '19 123': 4,  // Psalms
  '19 124': 8,  // Psalms
  '19 125': 5,  // Psalms
  '19 126': 6,  // Psalms
  '19 127': 5,  // Psalms
  '19 128': 6,  // Psalms
  '19 129': 8,  // Psalms
  '19 130': 8,  // Psalms
  '19 131': 3,  // Psalms
  '19 132': 18,  // Psalms
  '19 133': 3,  // Psalms
  '19 134': 3,  // Psalms
  '19 135': 21,  // Psalms
  '19 136': 26,  // Psalms
  '19 137': 9,  // Psalms
  '19 138': 8,  // Psalms
  '19 139': 24,  // Psalms
  '19 140': 13,  // Psalms
  '19 141': 10,  // Psalms
  '19 142': 7,  // Psalms
  '19 143': 12,  // Psalms
  '19 144': 15,  // Psalms
  '19 145': 21,  // Psalms
  '19 146': 10,  // Psalms
  '19 147': 20,  // Psalms
  '19 148': 14,  // Psalms
  '19 149': 9,  // Psalms
  '19 150': 6,  // Psalms
  '20 1': 33,  // Proverbs
  '20 2': 22,  // Proverbs
  '20 3': 35,  // Proverbs
  '20 4': 27,  // Proverbs
  '20 5': 23,  // Proverbs
  '20 6': 35,  // Proverbs
  '20 7': 27,  // Proverbs
  '20 8': 36,  // Proverbs
  '20 9': 18,  // Proverbs
  '20 10': 32,  // Proverbs
  '20 11': 31,  // Proverbs
  '20 12': 28,  // Proverbs
  '20 13': 25,  // Proverbs
  '20 14': 35,  // Proverbs
  '20 15': 33,  // Proverbs
  '20 16': 33,  // Proverbs
  '20 17': 28,  // Proverbs
  '20 18': 24,  // Proverbs
  '20 19': 29,  // Proverbs
  '20 20': 30,  // Proverbs
  '20 21': 31,  // Proverbs
  '20 22': 29,  // Proverbs
  '20 23': 35,  // Proverbs
  '20 24': 34,  // Proverbs
  '20 25': 28,  // Proverbs
  '20 26': 28,  // Proverbs
  '20 27': 27,  // Proverbs
  '20 28': 28,  // Proverbs
  '20 29': 27,  // Proverbs
  '20 30': 33,  // Proverbs
  '20 31': 31,  // Proverbs
  '21 1': 18,  // Ecclesiastes
  '21 2': 26,  // Ecclesiastes
  '21 3': 22,  // Ecclesiastes
  '21 4': 16,  // Ecclesiastes
  '21 5': 20,  // Ecclesiastes
  '21 6': 12,  // Ecclesiastes
  '21 7': 29,  // Ecclesiastes
  '21 8': 17,  // Ecclesiastes
  '21 9': 18,  // Ecclesiastes
  '21 10': 20,  // Ecclesiastes
  '21 11': 10,  // Ecclesiastes
  '21 12': 14,  // Ecclesiastes
  '22 1': 17,  // Song of Solomon
  '22 2': 17,  // Song of Solomon
  '22 3': 11,  // Song of Solomon
  '22 4': 16,  // Song of Solomon
  '22 5': 16,  // Song of Solomon
  '22 6': 13,  // Song of Solomon
  '22 7': 13,  // Song of Solomon
  '22 8': 14,  // Song of Solomon
  '23 1': 31,  // Isaiah
  '23 2': 22,  // Isaiah
  '23 3': 26,  // Isaiah
  '23 4': 6,  // Isaiah
  '23 5': 30,  // Isaiah
  '23 6': 13,  // Isaiah
  '23 7': 25,  // Isaiah
  '23 8': 22,  // Isaiah
  '23 9': 21,  // Isaiah
  '23 10': 34,  // Isaiah
  '23 11': 16,  // Isaiah
  '23 12': 6,  // Isaiah
  '23 13': 22,  // Isaiah
  '23 14': 32,  // Isaiah
  '23 15': 9,  // Isaiah
  '23 16': 14,  // Isaiah
  '23 17': 14,  // Isaiah
  '23 18': 7,  // Isaiah
  '23 19': 25,  // Isaiah
  '23 20': 6,  // Isaiah
  '23 21': 17,  // Isaiah
  '23 22': 25,  // Isaiah
  '23 23': 18,  // Isaiah
  '23 24': 23,  // Isaiah
  '23 25': 12,  // Isaiah
  '23 26': 21,  // Isaiah
  '23 27': 13,  // Isaiah
  '23 28': 29,  // Isaiah
  '23 29': 24,  // Isaiah
  '23 30': 33,  // Isaiah
  '23 31': 9,  // Isaiah
  '23 32': 20,  // Isaiah
  '23 33': 24,  // Isaiah
  '23 34': 17,  // Isaiah
  '23 35': 10,  // Isaiah
  '23 36': 22,  // Isaiah
  '23 37': 38,  // Isaiah
  '23 38': 22,  // Isaiah
  '23 39': 8,  // Isaiah
  '23 40': 31,  // Isaiah
  '23 41': 29,  // Isaiah
  '23 42': 25,  // Isaiah
  '23 43': 28,  // Isaiah
  '23 44': 28,  // Isaiah
  '23 45': 25,  // Isaiah
  '23 46': 13,  // Isaiah
  '23 47': 15,  // Isaiah
  '23 48': 22,  // Isaiah
  '23 49': 26,  // Isaiah
  '23 50': 11,  // Isaiah
  '23 51': 23,  // Isaiah
  '23 52': 15,  // Isaiah
  '23 53': 12,  // Isaiah
  '23 54': 17,  // Isaiah
  '23 55': 13,  // Isaiah
  '23 56': 12,  // Isaiah
  '23 57': 21,  // Isaiah
  '23 58': 14,  // Isaiah
  '23 59': 21,  // Isaiah
  '23 60': 22,  // Isaiah
  '23 61': 11,  // Isaiah
  '23 62': 12,  // Isaiah
  '23 63': 19,  // Isaiah
  '23 64': 12,  // Isaiah
  '23 65': 25,  // Isaiah
  '23 66': 24,  // Isaiah
  '24 1': 19,  // Jeremiah
  '24 2': 37,  // Jeremiah
  '24 3': 25,  // Jeremiah
  '24 4': 31,  // Jeremiah
  '24 5': 31,  // Jeremiah
  '24 6': 30,  // Jeremiah
  '24 7': 34,  // Jeremiah
  '24 8': 22,  // Jeremiah
  '24 9': 26,  // Jeremiah
  '24 10': 25,  // Jeremiah
  '24 11': 23,  // Jeremiah
  '24 12': 17,  // Jeremiah
  '24 13': 27,  // Jeremiah
  '24 14': 22,  // Jeremiah
  '24 15': 21,  // Jeremiah
  '24 16': 21,  // Jeremiah
  '24 17': 27,  // Jeremiah
  '24 18': 23,  // Jeremiah
  '24 19': 15,  // Jeremiah
  '24 20': 18,  // Jeremiah
  '24 21': 14,  // Jeremiah
  '24 22': 30,  // Jeremiah
  '24 23': 40,  // Jeremiah
  '24 24': 10,  // Jeremiah
  '24 25': 38,  // Jeremiah
  '24 26': 24,  // Jeremiah
  '24 27': 22,  // Jeremiah
  '24 28': 17,  // Jeremiah
  '24 29': 32,  // Jeremiah
  '24 30': 24,  // Jeremiah
  '24 31': 40,  // Jeremiah
  '24 32': 44,  // Jeremiah
  '24 33': 26,  // Jeremiah
  '24 34': 22,  // Jeremiah
  '24 35': 19,  // Jeremiah
  '24 36': 32,  // Jeremiah
  '24 37': 21,  // Jeremiah
  '24 38': 28,  // Jeremiah
  '24 39': 18,  // Jeremiah
  '24 40': 16,  // Jeremiah
  '24 41': 18,  // Jeremiah
  '24 42': 22,  // Jeremiah
  '24 43': 13,  // Jeremiah
  '24 44': 30,  // Jeremiah
  '24 45': 5,  // Jeremiah
  '24 46': 28,  // Jeremiah
  '24 47': 7,  // Jeremiah
  '24 48': 47,  // Jeremiah
  '24 49': 39,  // Jeremiah
  '24 50': 46,  // Jeremiah
  '24 51': 64,  // Jeremiah
  '24 52': 34,  // Jeremiah
  '25 1': 22,  // Lamentations
  '25 2': 22,  // Lamentations
  '25 3': 66,  // Lamentations
  '25 4': 22,  // Lamentations
  '25 5': 22,  // Lamentations
  '26 1': 28,  // Ezekiel
  '26 2': 10,  // Ezekiel
  '26 3': 27,  // Ezekiel
  '26 4': 17,  // Ezekiel
  '26 5': 17,  // Ezekiel
  '26 6': 14,  // Ezekiel
  '26 7': 27,  // Ezekiel
  '26 8': 18,  // Ezekiel
  '26 9': 11,  // Ezekiel
  '26 10': 22,  // Ezekiel
  '26 11': 25,  // Ezekiel
  '26 12': 28,  // Ezekiel
  '26 13': 23,  // Ezekiel
  '26 14': 23,  // Ezekiel
  '26 15': 8,  // Ezekiel
  '26 16': 63,  // Ezekiel
  '26 17': 24,  // Ezekiel
  '26 18': 32,  // Ezekiel
  '26 19': 14,  // Ezekiel
  '26 20': 49,  // Ezekiel
  '26 21': 32,  // Ezekiel
  '26 22': 31,  // Ezekiel
  '26 23': 49,  // Ezekiel
  '26 24': 27,  // Ezekiel
  '26 25': 17,  // Ezekiel
  '26 26': 21,  // Ezekiel
  '26 27': 36,  // Ezekiel
  '26 28': 26,  // Ezekiel
  '26 29': 21,  // Ezekiel
  '26 30': 26,  // Ezekiel
  '26 31': 18,  // Ezekiel
  '26 32': 32,  // Ezekiel
  '26 33': 33,  // Ezekiel
  '26 34': 31,  // Ezekiel
  '26 35': 15,  // Ezekiel
  '26 36': 38,  // Ezekiel
  '26 37': 28,  // Ezekiel
  '26 38': 23,  // Ezekiel
  '26 39': 29,  // Ezekiel
  '26 40': 49,  // Ezekiel
  '26 41': 26,  // Ezekiel
  '26 42': 20,  // Ezekiel
  '26 43': 27,  // Ezekiel
  '26 44': 31,  // Ezekiel
  '26 45': 25,  // Ezekiel
  '26 46': 24,  // Ezekiel
  '26 47': 23,  // Ezekiel
  '26 48': 35,  // Ezekiel
  '27 1': 21,  // Daniel
  '27 2': 49,  // Daniel
  '27 3': 30,  // Daniel
  '27 4': 37,  // Daniel
  '27 5': 31,  // Daniel
  '27 6': 28,  // Daniel
  '27 7': 28,  // Daniel
  '27 8': 27,  // Daniel
  '27 9': 27,  // Daniel
  '27 10': 21,  // Daniel
  '27 11': 45,  // Daniel
  '27 12': 13,  // Daniel
  '28 1': 11,  // Hosea
  '28 2': 23,  // Hosea
  '28 3': 5,  // Hosea
  '28 4': 19,  // Hosea
  '28 5': 15,  // Hosea
  '28 6': 11,  // Hosea
  '28 7': 16,  // Hosea
  '28 8': 14,  // Hosea
  '28 9': 17,  // Hosea
  '28 10': 15,  // Hosea
  '28 11': 12,  // Hosea
  '28 12': 14,  // Hosea
  '28 13': 16,  // Hosea
  '28 14': 9,  // Hosea
  '29 1': 20,  // Joel
  '29 2': 32,  // Joel
  '29 3': 21,  // Joel
  '30 1': 15,  // Amos
  '30 2': 16,  // Amos
  '30 3': 15,  // Amos
  '30 4': 13,  // Amos
  '30 5': 27,  // Amos
  '30 6': 14,  // Amos
  '30 7': 17,  // Amos
  '30 8': 14,  // Amos
  '30 9': 15,  // Amos
  '31 1': 21,  // Obadiah
  '32 1': 17,  // Jonah
  '32 2': 10,  // Jonah
  '32 3': 10,  // Jonah
  '32 4': 11,  // Jonah
  '33 1': 16,  // Micah
  '33 2': 13,  // Micah
  '33 3': 12,  // Micah
  '33 4': 13,  // Micah
  '33 5': 15,  // Micah
  '33 6': 16,  // Micah
  '33 7': 20,  // Micah
  '34 1': 15,  // Nahum
  '34 2': 13,  // Nahum
  '34 3': 19,  // Nahum
  '35 1': 17,  // Habakkuk
  '35 2': 20,  // Habakkuk
  '35 3': 19,  // Habakkuk
  '36 1': 18,  // Zephaniah
  '36 2': 15,  // Zephaniah
  '36 3': 20,  // Zephaniah
  '37 1': 15,  // Haggai
  '37 2': 23,  // Haggai
  '38 1': 21,  // Zechariah
  '38 2': 13,  // Zechariah
  '38 3': 10,  // Zechariah
  '38 4': 14,  // Zechariah
  '38 5': 11,  // Zechariah
  '38 6': 15,  // Zechariah
  '38 7': 14,  // Zechariah
  '38 8': 23,  // Zechariah
  '38 9': 17,  // Zechariah
  '38 10': 12,  // Zechariah
  '38 11': 17,  // Zechariah
  '38 12': 14,  // Zechariah
  '38 13': 9,  // Zechariah
  '38 14': 21,  // Zechariah
  '39 1': 14,  // Malachi
  '39 2': 17,  // Malachi
  '39 3': 18,  // Malachi
  '39 4': 6,  // Malachi
  '40 1': 25,  // Matthew
  '40 2': 23,  // Matthew
  '40 3': 17,  // Matthew
  '40 4': 25,  // Matthew
  '40 5': 48,  // Matthew
  '40 6': 34,  // Matthew
  '40 7': 29,  // Matthew
  '40 8': 34,  // Matthew
  '40 9': 38,  // Matthew
  '40 10': 42,  // Matthew
  '40 11': 30,  // Matthew
  '40 12': 49,  // Matthew
  '40 13': 58,  // Matthew
  '40 14': 36,  // Matthew
  '40 15': 39,  // Matthew
  '40 16': 28,  // Matthew
  '40 17': 26,  // Matthew
  '40 18': 34,  // Matthew
  '40 19': 30,  // Matthew
  '40 20': 34,  // Matthew
  '40 21': 46,  // Matthew
  '40 22': 46,  // Matthew
  '40 23': 38,  // Matthew
  '40 24': 51,  // Matthew
  '40 25': 46,  // Matthew
  '40 26': 75,  // Matthew
  '40 27': 66,  // Matthew
  '40 28': 20,  // Matthew
  '41 1': 45,  // Mark
  '41 2': 28,  // Mark
  '41 3': 35,  // Mark
  '41 4': 41,  // Mark
  '41 5': 43,  // Mark
  '41 6': 56,  // Mark
  '41 7': 36,  // Mark
  '41 8': 38,  // Mark
  '41 9': 48,  // Mark
  '41 10': 52,  // Mark
  '41 11': 32,  // Mark
  '41 12': 44,  // Mark
  '41 13': 37,  // Mark
  '41 14': 72,  // Mark
  '41 15': 46,  // Mark
  '41 16': 20,  // Mark
  '42 1': 80,  // Luke
  '42 2': 52,  // Luke
  '42 3': 38,  // Luke
  '42 4': 44,  // Luke
  '42 5': 39,  // Luke
  '42 6': 49,  // Luke
  '42 7': 50,  // Luke
  '42 8': 56,  // Luke
  '42 9': 62,  // Luke
  '42 10': 42,  // Luke
  '42 11': 54,  // Luke
  '42 12': 59,  // Luke
  '42 13': 35,  // Luke
  '42 14': 35,  // Luke
  '42 15': 32,  // Luke
  '42 16': 31,  // Luke
  '42 17': 36,  // Luke
  '42 18': 43,  // Luke
  '42 19': 48,  // Luke
  '42 20': 47,  // Luke
  '42 21': 38,  // Luke
  '42 22': 71,  // Luke
  '42 23': 55,  // Luke
  '42 24': 53,  // Luke
  '43 1': 51,  // John
  '43 2': 25,  // John
  '43 3': 36,  // John
  '43 4': 54,  // John
  '43 5': 46,  // John
  '43 6': 71,  // John
  '43 7': 52,  // John
  '43 8': 48,  // John
  '43 9': 41,  // John
  '43 10': 42,  // John
  '43 11': 57,  // John
  '43 12': 50,  // John
  '43 13': 38,  // John
  '43 14': 31,  // John
  '43 15': 27,  // John
  '43 16': 33,  // John
  '43 17': 26,  // John
  '43 18': 40,  // John
  '43 19': 42,  // John
  '43 20': 31,  // John
  '43 21': 25,  // John
  '44 1': 26,  // Acts
  '44 2': 47,  // Acts
  '44 3': 26,  // Acts
  '44 4': 37,  // Acts
  '44 5': 42,  // Acts
  '44 6': 15,  // Acts
  '44 7': 60,  // Acts
  '44 8': 39,  // Acts
  '44 9': 43,  // Acts
  '44 10': 48,  // Acts
  '44 11': 30,  // Acts
  '44 12': 25,  // Acts
  '44 13': 52,  // Acts
  '44 14': 28,  // Acts
  '44 15': 40,  // Acts
  '44 16': 40,  // Acts
  '44 17': 34,  // Acts
  '44 18': 28,  // Acts
  '44 19': 41,  // Acts
  '44 20': 38,  // Acts
  '44 21': 40,  // Acts
  '44 22': 30,  // Acts
  '44 23': 35,  // Acts
  '44 24': 26,  // Acts
  '44 25': 27,  // Acts
  '44 26': 32,  // Acts
  '44 27': 44,  // Acts
  '44 28': 30,  // Acts
  '45 1': 32,  // Romans
  '45 2': 29,  // Romans
  '45 3': 31,  // Romans
  '45 4': 25,  // Romans
  '45 5': 21,  // Romans
  '45 6': 23,  // Romans
  '45 7': 25,  // Romans
  '45 8': 39,  // Romans
  '45 9': 33,  // Romans
  '45 10': 21,  // Romans
  '45 11': 36,  // Romans
  '45 12': 21,  // Romans
  '45 13': 14,  // Romans
  '45 14': 23,  // Romans
  '45 15': 33,  // Romans
  '45 16': 26,  // Romans
  '46 1': 31,  // 1 Corinthians
  '46 2': 16,  // 1 Corinthians
  '46 3': 23,  // 1 Corinthians
  '46 4': 21,  // 1 Corinthians
  '46 5': 13,  // 1 Corinthians
  '46 6': 20,  // 1 Corinthians
  '46 7': 40,  // 1 Corinthians
  '46 8': 13,  // 1 Corinthians
  '46 9': 27,  // 1 Corinthians
  '46 10': 33,  // 1 Corinthians
  '46 11': 34,  // 1 Corinthians
  '46 12': 31,  // 1 Corinthians
  '46 13': 13,  // 1 Corinthians
  '46 14': 40,  // 1 Corinthians
  '46 15': 58,  // 1 Corinthians
  '46 16': 24,  // 1 Corinthians
  '47 1': 24,  // 2 Corinthians
  '47 2': 17,  // 2 Corinthians
  '47 3': 18,  // 2 Corinthians
  '47 4': 18,  // 2 Corinthians
  '47 5': 21,  // 2 Corinthians
  '47 6': 18,  // 2 Corinthians
  '47 7': 16,  // 2 Corinthians
  '47 8': 24,  // 2 Corinthians
  '47 9': 15,  // 2 Corinthians
  '47 10': 18,  // 2 Corinthians
  '47 11': 33,  // 2 Corinthians
  '47 12': 21,  // 2 Corinthians
  '47 13': 14,  // 2 Corinthians
  '48 1': 24,  // Galatians
  '48 2': 21,  // Galatians
  '48 3': 29,  // Galatians
  '48 4': 31,  // Galatians
  '48 5': 26,  // Galatians
  '48 6': 18,  // Galatians
  '49 1': 23,  // Ephesians
  '49 2': 22,  // Ephesians
  '49 3': 21,  // Ephesians
  '49 4': 32,  // Ephesians
  '49 5': 33,  // Ephesians
  '49 6': 24,  // Ephesians
  '50 1': 30,  // Philippians
  '50 2': 30,  // Philippians
  '50 3': 21,  // Philippians
  '50 4': 23,  // Philippians
  '51 1': 29,  // Colossians
  '51 2': 23,  // Colossians
  '51 3': 25,  // Colossians
  '51 4': 18,  // Colossians
  '52 1': 10,  // 1 Thessalonians
  '52 2': 20,  // 1 Thessalonians
  '52 3': 13,  // 1 Thessalonians
  '52 4': 18,  // 1 Thessalonians
  '52 5': 28,  // 1 Thessalonians
  '53 1': 12,  // 2 Thessalonians
  '53 2': 17,  // 2 Thessalonians
  '53 3': 18,  // 2 Thessalonians
  '54 1': 20,  // 1 Timothy
  '54 2': 15,  // 1 Timothy
  '54 3': 16,  // 1 Timothy
  '54 4': 16,  // 1 Timothy
  '54 5': 25,  // 1 Timothy
  '54 6': 21,  // 1 Timothy
  '55 1': 18,  // 2 Timothy
  '55 2': 26,  // 2 Timothy
  '55 3': 17,  // 2 Timothy
  '55 4': 22,  // 2 Timothy
  '56 1': 16,  // Titus
  '56 2': 15,  // Titus
  '56 3': 15,  // Titus
  '57 1': 25,  // Philemon
  '58 1': 14,  // Hebrews
  '58 2': 18,  // Hebrews
  '58 3': 19,  // Hebrews
  '58 4': 16,  // Hebrews
  '58 5': 14,  // Hebrews
  '58 6': 20,  // Hebrews
  '58 7': 28,  // Hebrews
  '58 8': 13,  // Hebrews
  '58 9': 28,  // Hebrews
  '58 10': 39,  // Hebrews
  '58 11': 40,  // Hebrews
  '58 12': 29,  // Hebrews
  '58 13': 25,  // Hebrews
  '59 1': 27,  // James
  '59 2': 26,  // James
  '59 3': 18,  // James
  '59 4': 17,  // James
  '59 5': 20,  // James
  '60 1': 25,  // 1 Peter
  '60 2': 25,  // 1 Peter
  '60 3': 22,  // 1 Peter
  '60 4': 19,  // 1 Peter
  '60 5': 14,  // 1 Peter
  '61 1': 21,  // 2 Peter
  '61 2': 22,  // 2 Peter
  '61 3': 18,  // 2 Peter
  '62 1': 10,  // 1 John
  '62 2': 29,  // 1 John
  '62 3': 24,  // 1 John
  '62 4': 21,  // 1 John
  '62 5': 21,  // 1 John
  '63 1': 13,  // 2 John
  '64 1': 15,  // 3 John
  '65 1': 25,  // Jude
  '66 1': 20,  // Revelation
  '66 2': 29,  // Revelation
  '66 3': 22,  // Revelation
  '66 4': 11,  // Revelation
  '66 5': 14,  // Revelation
  '66 6': 17,  // Revelation
  '66 7': 17,  // Revelation
  '66 8': 13,  // Revelation
  '66 9': 21,  // Revelation
  '66 10': 11,  // Revelation
  '66 11': 19,  // Revelation
  '66 12': 17,  // Revelation
  '66 13': 18,  // Revelation
  '66 14': 20,  // Revelation
  '66 15': 8,  // Revelation
  '66 16': 21,  // Revelation
  '66 17': 18,  // Revelation
  '66 18': 24,  // Revelation
  '66 19': 21,  // Revelation
  '66 20': 15,  // Revelation
  '66 21': 27,  // Revelation
  '66 22': 21,  // Revelation
}

module.exports = {
  default: JWLLinkerPlugin,
};

/* ✏️ TYPES */

/**
 * An item in the history cache
 * @typedef {Object} THistory
 * @property {string} key
 * @property {string} url
 * @property {string} link
 * @property {Array<string>} content
 */

/**
 * @typedef {Array<TReference>} TReferences
 */

/**
 * Scripture reference match :      one or more verse passages within same bible book
 * @typedef {Object} TReference
 * @property {string} original      reference as matched, for replacement purposes
 * @property {string} book          book name (and ordinal is needed), no spaces
 * @property {Array<TPassage>} passages  all groups of book/chapter/verse references
 * @property {boolean} isPlainText  treat as plain text (no hyperlink)?
 * @property {boolean} isLinkAlready is already a wiki or MD link?
 */

/**
 * Passage : chapter + contiguous verse span, e.g. 8:1-4 or 9:4,5
 * @typedef {Object} TPassage
 * @property {PrefixType} prefixType  show the full book name [and chapter]?
 * @property {string} delimiter     punctuation symbol before the passage text , or ;
 * @property {string} displayFull   complete bible display name
 * @property {string} display       display name as per original source, could be missing book or chapter
 * @property {number} chapter       chapter number
 * @property {TVerse} verse         verse span (first, last)
 * @property {TLink} link           hyperlink info (null if invalid/plaintext)
 * @property {OutputError} error    possible parsing error
 * @property {boolean} noChapter    is book with no chapter (phm 2jo 3jo jude)
 * @property {boolean} noVerse      is book with chapter only, no verses
 */

/**
 * Verse span : first to last (inclusive)
 * @typedef {Object} TVerse
 * @property {number} first         first verse in span
 * @property {number} last          last verse in span
 * @property {string} separator     between the verse span - or ,
 */

/**
 * Hyperlink info for a bible passage
 * @typedef {Object} TLink
 * @property {string} jwlib         JWLibrary link for the hyperlink
 * @property {string} jworg         wol.jw.org link to lookup citation
 * @property {Array<string>} parIds list of par ids to lookup each verse content
 * @property {string} bookChapId    book and chapter portion of the par id
 */

/**
 * All the parts of a JW url
 * @typedef {Object} TJWLink
 * @property {string} whole
 * @property {string} title
 * @property {string} url
 * @property {string} docId
 * @property {string} parId
 */
