#NodeHtmlParser
A forgiving HTML/XML/RSS parser written in JS for both the browser and NodeJS (yes, despite the name it works just fine in any modern browser). The parser can handle streams (chunked data) and supports custom handlers for writing custom DOMs/output.

##Running Tests
	node tests/00-runtests.js

##Usage

```javascript
var htmlparser = require("htmlparser2");
var parser = new htmlparser.Parser({
	onopentag: function(name, attribs){
		if(name === "script" && attribs["language"] === "javascript"){
			console.log("JS! Hooray!");
		}
	},
	ontext: function(text){
		console.log("-->", text);
	},
	onclosetag: function(tagname){
		if(tagname === "script"){
			console.log("That's it?!");
		}
	}
	parser.done();	

##Parsing RSS/Atom Feeds

	new htmlparser.RssHandler(function (error, dom) {
		...
	});

###Usage In Browser
	var handler = new Tautologistics.NodeHtmlParser.DefaultHandler(function (error, dom) {
		if (error)
			[...do something for errors...]
		else
			[...parsing done, do something...]
	});
	var parser = new Tautologistics.NodeHtmlParser.Parser(handler);
	parser.parseComplete(document.body.innerHTML);
	alert(JSON.stringify(handler.dom, null, 2));

##DefaultHandler Options

###Usage
	var handler = new htmlparser.DefaultHandler(
		  function (error) { ... }
		, { verbose: false, ignoreWhitespace: true }
		);
	
###Option: ignoreWhitespace
Indicates whether the DOM should exclude text nodes that consists solely of whitespace. The default value is "false".

####Example: true
The following HTML:
	<font>
		<br>this is the text
	<font>
becomes:
	[ { raw: 'font'
	  , data: 'font'
	  , type: 'tag'
	  , name: 'font'
	  , children: 
	     [ { raw: 'br', data: 'br', type: 'tag', name: 'br' }
	     , { raw: 'this is the text\n'
	       , data: 'this is the text\n'
	       , type: 'text'
	       }
	     , { raw: 'font', data: 'font', type: 'tag', name: 'font' }
	     ]
	  }
	]

####Example: false
The following HTML:
	<font>
		<br>this is the text
	<font>
becomes:
	[ { raw: 'font'
	  , data: 'font'
	  , type: 'tag'
	  , name: 'font'
	  , children: 
	     [ { raw: '\n\t', data: '\n\t', type: 'text' }
	     , { raw: 'br', data: 'br', type: 'tag', name: 'br' }
	     , { raw: 'this is the text\n'
	       , data: 'this is the text\n'
	       , type: 'text'
	       }
	     , { raw: 'font', data: 'font', type: 'tag', name: 'font' }
	     ]
	  }
	]

###Option: verbose
Indicates whether to include extra information on each node in the DOM. This information consists of the "raw" attribute (original, unparsed text found between "<" and ">") and the "data" attribute on "tag", "script", and "comment" nodes. The default value is "true". 

####Example: true
The following HTML:
	<a href="test.html">xxx</a>
becomes:
	[ { raw: 'a href="test.html"'
	  , data: 'a href="test.html"'
	  , type: 'tag'
	  , name: 'a'
	  , attribs: { href: 'test.html' }
	  , children: [ { raw: 'xxx', data: 'xxx', type: 'text' } ]
	  }
	]

####Example: false
The following HTML:
	<a href="test.html">xxx</a>
becomes:
	[ { type: 'tag'
	  , name: 'a'
	  , attribs: { href: 'test.html' }
	  , children: [ { data: 'xxx', type: 'text' } ]
	  }
	]

###Option: enforceEmptyTags
Indicates whether the DOM should prevent children on tags marked as empty in the HTML spec. Typically this should be set to "true" HTML parsing and "false" for XML parsing. The default value is "true".

####Example: true
The following HTML:
	<link>text</link>
becomes:
	[ { raw: 'link', data: 'link', type: 'tag', name: 'link' }
	, { raw: 'text', data: 'text', type: 'text' }
	]

Output (simplified):

##DomUtils

###TBD (see utils_example.js for now)

##Related Projects

Looking for CSS selectors to search the DOM? Try Node-SoupSelect, a port of SoupSelect to NodeJS: http://github.com/harryf/node-soupselect

There's also a port of hpricot to NodeJS that uses node-HtmlParser for HTML parsing: http://github.com/silentrob/Apricot

```javascript
new htmlparser.FeedHandler(function(<error> error, <object> feed){
    ...
});
```

##Performance
Using a slightly modified version of [node-expat](https://github.com/astro/node-expat)s `bench.js`, I received the following results (on a MacBook (late 2010):

* [htmlparser](https://github.com/tautologistics/node-htmlparser): 51779 el/s
* [sax.js](https://github.com/isaacs/sax-js): 53169 el/s
* [node-expat](https://github.com/astro/node-expat): 103388 el/s
* [htmlparser2](https://github.com/fb55/node-htmlparser): 118614 el/s

The test may be found in `tests/bench.js`.

##How is this different from [node-htmlparser](https://github.com/tautologistics/node-htmlparser)?
This is a fork of the project above. The main difference is that this is just intended to be used with node (it runs on other platforms using [browserify](https://github.com/substack/node-browserify)). Besides, the code is much better structured, has less duplications and is remarkably faster than the original. 

The parser now provides a callback interface close to [sax.js](https://github.com/isaacs/sax-js) (originally intended for [readabilitySAX](https://github.com/fb55/readabilitysax)). I also fixed a couple of bugs & included some pull requests for the original project (eg. [RDF feed support](https://github.com/tautologistics/node-htmlparser/pull/35)).

The support for location data and verbose output was removed a couple of versions ago. It's still available in the [verbose branch](https://github.com/FB55/node-htmlparser/tree/verbose). 

The `DefaultHandler` and the `RssHandler` were renamed to clarify their purpose (to `DomHandler` and `FeedHandler`). The old names are still available when requiring `htmlparser2`, so your code should work as expected.