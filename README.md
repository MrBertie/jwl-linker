# JWL Linker Plugin for [Obsidian](https://obsidian.md)

Display all scripture references as *JW Library* links In Reading View. Adds a commands to convert scriptures references and JW.Org Finder links to *JW Library* links in Editing View, and fetch verse and paragraph citations from JW.Org Finder links.

# How to Install

Download the latest **jwl-linker** [release](https://github.com/MrBertie/jwl-linker/releases), unzip it, and drop the folder into your `{Obsidian Vault}/.obsidian/plugins` folder.  Edit the plugin folder name to remove the version number, e.g. `-v.0.1.1`, and then restart Obsidian.
You will need to go to the *Plugin Settings* page in Obsidian and enable the plugin.


# How to Use In Reading View

Displays all valid Scripture References as *JW Library* links.
Open any page that contains bible verse references, e.g. `Rom 1:20; Psalm 89:18; 1 Cor 9:26, etc...` and then simply switch to *Reading View.*  

You should see that all Scripture references are now displayed as functioning hyperlinks; in addition any abbreviated bible book names will be written out in full.  Invalid scripture references will be ignored.

> Note: This only affects the *Reading View*, it does not modify the Markdown text.


# How to Use In Editing View

The plugin provides 7 new Commands:

1. Link scripture to JWLibrary
1. Switch web link to JWLibrary
1. Cite scripture in full
1. Cite scripture snippet
1. Cite paragraph from link
1. Cite snippet from link
1. Add title to link

To access the commands:
- On Desktop: right-click next to the scripture, and hover on *JWL Linker* to see the list of commands.
- On Mobile: add a toolbar item for the *JWL Linker* command.

----

## 1. Link scripture to JWLibrary

This command converts Bible scripture references to *JW Library* links.
Click anywhere in a line or select text that contains either a scripture reference then click the command and the scripture should become a local JW Library links.

> Note: Unlike the 'Reading View' option above this command permanently rewrites scripture references as a markdown style link in the Markdown text.  The Reading View option is non-destructive.

## 2. Switch web link to JWLibrary

Converts existing wol.jw.org and jw.org Finder style links [^1] into local JW Library links.

----

## 3. Cite scripture in full

This command fetches bible verse content online and inserts ('cites') the text directly into the markdown content, usually as a Callout (can be changed in the settings via a template).  Any contiguous range of verses is accepted, e.g. `Ac 12:1-4.`
Click anywhere in the scripture reference, then click the run the command.  The plugin will show a popup notice while it is fetching the citation, and then insert it together with the scripture.

IMPORTANT: only one scripture reference can be fetched at a time.

### 4. Cite scripture snippet

As above but only shows a snippet of the verse text.  THe length of the snippet can be changed in the settings.

----

## 5. Cite paragraph from link

This command fetches the paragraph content from an existing wol.jw.org link and inserts it as a Callout (can also be changed in the settings via template), together with the correct navigation title.

Note: to create this kind of wol.jw.org link first click on a paragraph (you will see faint underlining), then copy the page link.

## 6. Cite snippet from link

As above, but only inserts a snippet of the paragraph.

## 7. Add title to link

Adds the correct navigation title to an existing wol.jw.org link.

----

# Opening links

Click on a newly created link to open it directly in your installed *JW Library* app at that scripture or publication reference.


# Plugin Settings

1. Scripture citation template: Use the template to define how the cited verses should look. All markdown syntax is accepted.
2. Paragraph citation template: Use the template to define how the cited paragraph should look. All markdown syntax is accepted.
3. Snippet citation template.
4. Snippet word length: how many words to show in the snippet.
5. Verse number in bold: Should the verse numbers be in bold text?
6. Link to cited scripture: Should the plugin add a JW Library link to the scripture reference also?


# Tips for using Commands

You can also:
  1. Use a plugin like *Commander* to add the new command wherever you prefer
  2. Use the *Command palette* `Ctrl + P` to call up the commands as needed; just start typing "jw..." and they should be listed  
  3. You can also used *Pinned commands* in the *Command Palette* to keep them available at the top (works well on mobile)

[^1]: The type of link you get when you click on the 'Share Link' option on JW.Org, WOL.Org, or in the *JW Library* App.

