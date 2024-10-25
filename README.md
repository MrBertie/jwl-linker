# JWL Linker Plugin for [Obsidian](https://obsidian.md)

Display all scripture references as *JW Library* links In Reading View. Adds commands to convert scriptures references and JW.Org links to *JW Library* links. Adds commands to fetch verse, paragraph, and publication citations.

# How to Install

Download the [latest version](https://github.com/MrBertie/jwl-linker/archive/refs/heads/main.zip) from this link, and unzip it.  
You see a folder called `jwl-linker-main`; rename this folder as `jwl-linker` and then add it into your `{Obsidian Vault}/.obsidian/plugins` folder.  
Restart Obsidian and go to the *Community Plugins Settings* page to enable the plugin.

*Note: you can also click the `<>Code` button above and choose `Download.zip`*

# How to Use In Reading View

Displays all valid Scripture References as *JW Library* links.
Open any page that contains bible verse references, e.g. `Rom 1:20; Psalm 89:18; 1 Cor 9:26, etc...` and then simply switch to *Reading View.*  

You should see that all Scripture references are now displayed as functioning hyperlinks; in addition any abbreviated bible book names will be written out in full.  Invalid scripture references will be ignored.

> Note: This only affects the *Reading View*, it does not modify the Markdown text.


# How to Use In Editing View

The plugin provides many new commands to work with scriptures, publication references and JW.Org links.

To access the commands:
- On Desktop: right-click next to the scripture, and hover on *JWL Linker* to see the list of commands.
- On Mobile: add a toolbar item for the *JWL Linker* command.

| Command                                    | Mode | Target                          | Result                                                                                  | Replace target | Setting                                                                                                  |
| ------------------------------------------ | ---- | ------------------------------- | --------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| Convert scripture to JW Library            | Edit | Reference                       | `[[ JW Library url \| scripture reference ]]`                                           | Replaces       | None                                                                                                     |
| Convert jw.org url to JW Library           | Edit | wol.jw.org \| jw.org/finder url | `JW Library url<br/>( Converts just the url portion )`                                  | Replaces       | None                                                                                                     |
| Cite publication lookup                    | Edit | Publication reference           | `[[ JW Library url \| publication reference ]]<br/>< Full citation of lookup article >` | Adds below     | Paragraph citation template<br/>Initial number in bold                                                   |
| Cite scripture below                       | Edit | Reference                       | `[[ JW Library url \| scripture reference ]]<br/>< Full citation of verses >`           | Adds below     | Scripture citation template<br/>Initial number in bold<br/>Link to cited scripture                       |
| Cite scripture inline                      | Edit | Reference                       | `[[ JW Library url \| scripture reference ]] < snippet of verses >`                     | Replaces       | Snippet citation template<br/>Initial number in bold<br/>Link to cited scripture<br/>Snippet word length |
| Cite jw.org url below ¶ 1                        | Edit | wol.jw.org \| jw.org/finder url | `[[ original url \| article nav title ]]<br/>< Full citation of paragraph >`            | Adds below     | Paragraph citation template<br/>Initial number in bold                                                   |
| Cite jw.org url below ¶ 2                        | Edit | wol.jw.org \| jw.org/finder url | `[[ original url \| article nav title ]]<br/>< Full citation of 2 paragraph >`          | Adds below     | Paragraph citation template<br/>Initial number in bold                                                   |
| Cite jw.org url below ¶ 3                        | Edit | wol.jw.org \| jw.org/finder url | `[[ original url \| article nav title ]]<br/>< Full citation of 3 paragraph >`          | Adds below     | Paragraph citation template<br/>Initial number in bold                                                   |
| Cite jw.org url inline                     | Edit | wol.jw.org \| jw.org/finder url | `[[ original url \| article nav title ]] < snippet of paragraph >`                      | Replaces       | Snippet citation template<br/>Initial number in bold<br/>Snippet word length                             |
| Add title to jw.org url                    | Edit | wol.jw.org \| jw.org/finder url | `[[ original url \| article nav title ]]`                                               | Replaces       | None                                                                                                     |
| ( Display scriptures as JW Library links ) | HTML | Reference                       | `<a href …> scripture reference </a>`                                                   | Replaces       | None                                                                                                     |



# Details on the usage

## Convert scripture to JW Library 

This command converts Bible scripture references to *JW Library* links.
Click anywhere in a line or select text that contains scripture references then click the command and the scriptures should be converted to a local JW Library links.

> Note: Unlike the 'Reading View' option above this command permanently rewrites scripture references as a markdown style link in the Markdown text.  The Reading View option is non-destructive.

## Convert jw.org url to JW Library

Converts existing wol.jw.org and jw.org Finder style links [^1] into local JW Library links.

----

## Cite publication lookup

This command fetches the result of a standard WT publication reference, and inserts the resulting article below the original reference on the page.
Select the publication reference including the pages and run the command.

## Cite scripture below

This command fetches bible verse content online and inserts (or cites) the text directly into the page markdown content, usually as a Callout (can be changed in the settings via a template).  Any range of verses with in a single chapter is accepted, e.g. `Ac 12:1-4.`
Click anywhere in the scripture reference, then click the run the command.  The plugin will show a popup notice while it is fetching the citation, and then insert it together with the scripture.

### Cite scripture inline

As above but only shows a snippet of the verse text.  THe length of the snippet can be changed in the settings.

----

## Cite jw.org url below ¶ 1 ..¶ 2 ..¶ 3

This command fetches the paragraph content from an existing jw.org link and inserts it as a Callout (can also be changed in the settings via template), together with the correct navigation title.

Note: to create this kind of wol.jw.org link first click on a paragraph (you will see faint underlining), then copy the page link.

## Cite jw.org url inline  

As above, but only inserts a snippet of the paragraph.

## Add title to jw.org url 

Adds the correct navigation title to an existing wol.jw.org link.

----

# Opening links

Click on a newly created link to open it directly in your installed *JW Library* app at that scripture or publication reference.


# Plugin Settings

1. Scripture citation template: Use the template to define how the cited verses should look. All markdown syntax is accepted.
2. Paragraph citation template: Use the template to define how the cited paragraph should look. All markdown syntax is accepted.
3. Inine citation template.
4. Snippet word length: how many words to show in the snippet.
5. Number of history items to keep
6. Verse number in bold: Should the verse numbers be in bold text?
7. Link to cited scripture: Should the plugin add a JW Library link to the scripture reference also?


# Tips for using Commands

You can also:
  1. Use a plugin like *Commander* to add a new command wherever you prefer
  2. Use the *Command palette* `Ctrl + P` to call up the commands as needed; just start typing "jw..." and they should be listed  
  3. You can also used *Pinned commands* in the *Command Palette* to keep them available at the top (works well on mobile)

[^1]: The type of link you get when you click on the 'Share Link' option on JW.Org, WOL.Org, or in the *JW Library* App.

