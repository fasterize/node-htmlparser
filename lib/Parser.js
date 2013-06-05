var ElementType = require("./ElementType.js");

function Parser(cbs, options){
	this._options = options || defaultOpts;
	this._cbs = cbs || defaultCbs;
	this._buffer = "";
	this._tagSep = ">";
	this._stack = [];
	this._wroteSpecial = false;
	this._contentFlags = 0;
	this._done = false;
	this._running = true; //false if paused
}

//Regular expressions used for cleaning up and parsing (stateless)
var _reAttrib = /\s(\S+?)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))|\s|\/|$)/g,
	_reTail = /\s|\/|$/;

var defaultOpts = {
	xmlMode: false, //Special behavior for script/style tags by default
	lowerCaseAttributeNames: false, //call .toLowerCase for each attribute name
	lowerCaseTags: false //call .toLowerCase for each tag name
};

//**Public**//
//Methods//
//Parses a complete HTML and pushes it to the handler
Parser.prototype.parseComplete = function(data){
	this.reset();
	this.write(data);
	this.end();
};

//Parses a piece of an HTML document
Parser.prototype.parseChunk =
Parser.prototype.write = function(data){
	if(this._done) this._handleError("Attempted to parse chunk after parsing already done");
	this._buffer += data; //FIXME: this can be a bottleneck
	if(this._running) this._parseTags();
};

//Tells the parser that the HTML being parsed is complete
Parser.prototype.done =
Parser.prototype.end = function(chunk){
	if(this._done) return;

	if(chunk) this.write(chunk);
	this._done = true;
	
	if(this._running) this._finishParsing();
};

Parser.prototype._finishParsing = function(){
	//Parse the buffer to its end
	if(this._buffer) this._parseTags(true);
	
	if(this._cbs.onclosetag){
		while(this._stack.length) this._cbs.onclosetag(this._stack.pop());
	}
	
	if(this._cbs.onend) this._cbs.onend();
};

Parser.prototype.pause = function(){
	if(!this._done) this._running = false;
};

Parser.prototype.resume = function(){
	if(this._running) return;
	this._running = true;
	this._parseTags();
	if(this._done) this._finishParsing();
};

//Resets the parser to a blank state, ready to parse a new HTML document
Parser.prototype.reset = function(){
	Parser.call(this);
	if(this._cbs.onreset) this._cbs.onreset();
};

//Extracts the base tag name from the data value of an element
Parser.prototype._parseTagName = function(data){
	var match = data.substr(0, data.search(_reTail));
	if(!this._options.lowerCaseTags) return match;
	return match.toLowerCase();
};

//Special tags that are treated differently
var SpecialTags = {};
//SpecialTags[ElementType.Tag]   = 0x0;
SpecialTags[ElementType.Style]   = 0x1; //2^0
SpecialTags[ElementType.Script]  = 0x2; //2^1
SpecialTags[ElementType.Comment] = 0x4; //2^2
SpecialTags[ElementType.CDATA]   = 0x8; //2^3

var TagValues = {
	style: 1,
	script: 2
};

//Parses through HTML text and returns an array of found elements
Parser.prototype._parseTags = function(force){
	var current = 0,
	    opening = this._buffer.indexOf("<"),
	    closing = this._buffer.indexOf(">"),
	    next, rawData, elementData, lastTagSep;

	//if force is true, parse everything
	if(force) opening = Infinity;

	//opening !== closing is just false if both are -1
	while(opening !== closing && this._running){
		lastTagSep = this._tagSep;
		
		if((opening !== -1 && opening < closing) || closing === -1){
			next = opening;
			this._tagSep = "<";
			opening = this._buffer.indexOf("<", next + 1);
		}
		else{
			next = closing;
			this._tagSep = ">";
			closing = this._buffer.indexOf(">", next + 1);
		}
		rawData = this._buffer.substring(current, next); //The next chunk of data to parse
		
		//set elements for next run
		current = next + 1;
		
		if(this._contentFlags >= SpecialTags[ElementType.CDATA]){
			// We're inside a CDATA section
			this._writeCDATA(rawData);

		}
		else if(this._contentFlags >= SpecialTags[ElementType.Comment]){
			//We're in a comment tag
			this._writeComment(rawData);
		}
		else if(lastTagSep === "<"){
			elementData = rawData.trimLeft();
			if(elementData.charAt(0) === "/"){
				//elementData = elementData.substr(1).trim();
				elementData = this._parseTagName(elementData.substr(1));
				if(this._contentFlags !== 0){
					//if it's a closing tag, remove the flag
					if(this._contentFlags & TagValues[elementData]){
						//remove the flag
						this._contentFlags ^= TagValues[elementData];
					} else {
						this._writeSpecial(rawData, lastTagSep);
						continue;
					}
				}
				this._processCloseTag(elementData);
			}
			else if(this._contentFlags !== 0) this._writeSpecial(rawData, lastTagSep);
			else if(elementData.charAt(0) === "!"){
				if(elementData.substr(1, 7) === "[CDATA["){
					this._contentFlags |= SpecialTags[ElementType.CDATA];
					if(this._cbs.oncdatastart) this._cbs.oncdatastart();
					this._writeCDATA(elementData.substr(8));
				}
				else if(this._contentFlags !== 0) this._writeSpecial(rawData, lastTagSep);
				else if(elementData.substr(1, 2) === "--"){
					//This tag is a comment
					this._contentFlags |= SpecialTags[ElementType.Comment];
					this._writeComment(rawData.substr(3));
				}
				//TODO: This isn't a processing instruction, needs a new name
				else if(this._cbs.onprocessinginstruction){
					this._cbs.onprocessinginstruction(
						"!" + this._parseTagName(elementData.substr(1)),
						elementData
					);
				}
			}
			else if(elementData.charAt(0) === "?"){
				if(this._cbs.onprocessinginstruction){
					this._cbs.onprocessinginstruction(
						"?" + this._parseTagName(elementData.substr(1)),
						elementData
					);
				}
			}
			else this._processOpenTag(elementData);
		}
		else{
			if(this._contentFlags !== 0){
				this._writeSpecial(rawData, ">");
			}
			else if(this._cbs.ontext){
				if(this._tagSep === ">") rawData += ">"; //it's the second > in a row
				if(rawData !== "") this._cbs.ontext(rawData);
			}
		}
	}

	this._buffer = this._buffer.substr(current);
};

Parser.prototype._writeCDATA = function(data){
	if(this._tagSep === ">" && data.substr(-2) === "]]"){
		// CDATA ends
		if(data.length !== 2 && this._cbs.ontext){
			this._cbs.ontext(data.slice(0,-2));
		}
		this._contentFlags ^= SpecialTags[ElementType.CDATA];
		if(this._cbs.oncdataend) this._cbs.oncdataend();
		this._wroteSpecial = false;
    }
    else if(this._cbs.ontext) this._cbs.ontext(data + this._tagSep);
};

Parser.prototype._writeComment = function(rawData){
	if(this._tagSep === ">" && rawData.substr(-2) === "--"){ //comment ends
		//remove the written flag (also removes the comment flag)
		this._contentFlags ^= SpecialTags[ElementType.Comment];
		this._wroteSpecial = false;
		if(this._cbs.oncomment) this._cbs.oncomment(rawData.slice(0, -2));
		if(this._cbs.oncommentend) this._cbs.oncommentend();
	}
	else if(this._cbs.oncomment) this._cbs.oncomment(rawData + this._tagSep);
};

Parser.prototype._writeSpecial = function(rawData, lastTagSep){
	//if the previous element is text, append the last tag sep to element
	if(this._wroteSpecial){
		if(this._cbs.ontext) this._cbs.ontext(lastTagSep + rawData);
	}
	else{ //The previous element was not text
		this._wroteSpecial = true;
		if(rawData !== "" && this._cbs.ontext) this._cbs.ontext(rawData);
	}
};

var emptyTags = {
	area: true,
	base: true,
	basefont: true,
	br: true,
	col: true,
	frame: true,
	hr: true,
	img: true,
	input: true,
	isindex: true,
	link: true,
	meta: true,
	param: true,
	embed: true
};

function Parser(cbs, options){
	if(!options) options = defaultOpts;
	if(!cbs) cbs = defaultCbs;
	this._options = options;
	this._cbs = cbs;

	this._tagname = "";
	this._attribname = "";
	this._attribs = null;
	this._stack = [];
	this._done = false;

	this._tokenizer = new Tokenizer(options, this);
}

require("util").inherits(Parser, require("events").EventEmitter);

//Tokenizer event handlers
Parser.prototype.ontext = function(data){
	if(this._cbs.ontext) this._cbs.ontext(data);
};

Parser.prototype.onopentagname = function(name){
	if(!(this._options.xmlMode || "lowerCaseTags" in this._options) || this._options.lowerCaseTags){
		name = name.toLowerCase();
	}

	this._tagname = name;

	if (!this._options.xmlMode && name in openImpliesClose) {
		for(
			var el;
			(el = this._stack[this._stack.length-1]) in openImpliesClose[name];
			this.onclosetag(el)
		);
	}

	if(this._options.xmlMode || !(name in emptyTags)){
		this._stack.push(name);
	}

	if(this._cbs.onopentagname) this._cbs.onopentagname(name);
	if(this._cbs.onopentag) this._attribs = {};
};

Parser.prototype.onopentagend = function(){
	if(this._attribname !== "") this.onattribvalue("");
	if(this._attribs){
		if(this._cbs.onopentag) this._cbs.onopentag(this._tagname, this._attribs);
		this._attribs = null;
	}
	if(!this._options.xmlMode && this._cbs.onclosetag && this._tagname in emptyTags){
		this._cbs.onclosetag(this._tagname);
	}
	this._tagname = "";
};

	this._tokenizer
		.on("text", function(data){
			if(tagname !== ""){
				if(attribname !== "") attribValue("");
				if(attribs){
					if(cbs.onopentag) cbs.onopentag(tagname, attribs);
					attribs = null;
				}
				attribname = "";
			}
			if(cbs.ontext) cbs.ontext(data);
		})
		.on("opentagname", function(name){
			if(options.lowerCaseTags) name = name.toLowerCase();
			tagname = name;

			if (!options.xmlMode && name in openImpliesClose) {
				for(
					var el;
					(el = stack[stack.length-1]) in openImpliesClose[name];
					closeTag(el)
				);
			}
			if(cbs.onopentagname) cbs.onopentagname(name);
			if(cbs.onopentag) attribs = {};
		})
		.on("closetag", closeTag)
		.on("selfclosingtag", function(){
			closeTag(tagname);
		})
		.on("attribname", function(name){
			if(attribname !== "") attribValue("");
			if(options.lowerCaseAttributeNames) name = name.toLowerCase;
			attribname = name;
		})
		.on("attribvalue", attribValue)
		.on("declaration", function(value){
			if(cbs.onprocessinginstruction){
				cbs.onprocessinginstruction("!" + value.split(/\s|\//, 1)[0], "!" + value);
			}
		})
		.on("processinginstruction", function(value){
			if(cbs.onprocessinginstruction){
				cbs.onprocessinginstruction("?" + value.split(/\s|\//, 1)[0], "?" + value);
			}
		})
		.on("comment", function(value){
			if(cbs.oncomment) cbs.oncomment(value);
			if(cbs.oncommentend) cbs.oncommentend();
		})
		.on("cdata", function(value){
			if(cbs.oncdatastart) cbs.oncdatastart();
			if(cbs.ontext) cbs.ontext(value);
			if(cbs.oncdataend) cbs.oncdataend();
		})
		.on("error", function(err){
			if(cbs.onerror) cbs.onerror(err);
			else that.emit("error", err);
		})
		.once("finish", function(){
			if(cbs.onclosetag){
				for(
					var i = stack.length;
					i > 0;
					cbs.onclosetag(stack[--i])
				);
			}
			if(cbs.onend) cbs.onend();
		})
		;

Parser.prototype.onselfclosingtag = function(){
	var name = this._tagname;

	this.onopentagend();

	//self-closing tags won't be on the top of the stack
	//cheaper check than before
	if(this._stack[this._stack.length-1] === name){
		if(this._cbs.onclosetag){
			this._cbs.onclosetag(this._stack.pop());
		} else {
			this._stack.pop();
		}
	}
};

Parser.prototype.onattribname = function(name){
	if(this._attribname !== "") this.onattribvalue("");
	if(!(this._options.xmlMode || "lowerCaseAttributeNames" in this._options) || this._options.lowerCaseAttributeNames){
		name = name.toLowerCase();
	}
	this._attribname = name;
};

Parser.prototype.onattribvalue = function attribValue(value){
	if(this._cbs.onattribute) this._cbs.onattribute(this._attribname, value);
	if(this._attribs) this._attribs[this._attribname] = value;
	this._attribname = "";
};

Parser.prototype.ondeclaration = function(value){
	if(this._cbs.onprocessinginstruction){
		var name = value.split(/\s|\//, 1)[0];
		if(!(this._options.xmlMode || "lowerCaseTags" in this._options) || this._options.lowerCaseTags){
			name = name.toLowerCase();
		}
		this._cbs.onprocessinginstruction("!" + name, "!" + value);
	}
};

Parser.prototype.onprocessinginstruction = function(value){
	if(this._cbs.onprocessinginstruction){
		var name = value.split(/\s|\//, 1)[0];
		if(!(this._options.xmlMode || "lowerCaseTags" in this._options) || this._options.lowerCaseTags){
			name = name.toLowerCase();
		}
		this._cbs.onprocessinginstruction("?" + name, "?" + value);
	}
};

Parser.prototype.oncomment = function(value){
	if(this._cbs.oncomment) this._cbs.oncomment(value);
	if(this._cbs.oncommentend) this._cbs.oncommentend();
};

Parser.prototype.oncdata = function(value){
	if(this._options.xmlMode){
		if(this._cbs.oncdatastart) this._cbs.oncdatastart();
		if(this._cbs.ontext) this._cbs.ontext(value);
		if(this._cbs.oncdataend) this._cbs.oncdataend();
	} else {
		this.oncomment("[CDATA[" + value + "]]");
	}
};

Parser.prototype.onerror = function(err){
	if(this._cbs.onerror) this._cbs.onerror(err);
};

Parser.prototype.onend = function(){
	if(this._cbs.onclosetag){
		for(
			var i = this._stack.length;
			i > 0;
			this._cbs.onclosetag(this._stack[--i])
		);
	}
	if(this._cbs.onend) this._cbs.onend();
};


//Resets the parser to a blank state, ready to parse a new HTML document
Parser.prototype.reset = function(){
	this._tokenizer.removeAllListeners();
	Parser.call(this, this._cbs, this._options);
	if(this._cbs.onreset) this._cbs.onreset();
};

//Parses a complete HTML document and pushes it to the handler
Parser.prototype.parseComplete = function(data){
	this.reset();
	this.end(data);
};

Parser.prototype.write = function(chunk){
	if(this._done) this.onerror(Error(".write() after done!"));
	this._tokenizer.write(chunk);
};

Parser.prototype.end = function(chunk){
	if(this._done) this.onerror(Error(".end() after done!"));
	this._tokenizer.end(chunk);
	this._done = true;
};

//alias for backwards compat
Parser.prototype.parseChunk = Parser.prototype.write;
Parser.prototype.done = Parser.prototype.end;

module.exports = Parser;
