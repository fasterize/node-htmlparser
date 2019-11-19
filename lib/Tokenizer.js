module.exports = Tokenizer;

var	j = 0,

		SPECIAL_NONE                        = j++,
		SPECIAL_SCRIPT                       = j++,
		SPECIAL_STYLE                        = j++;

function whitespace(c){
	return c === " " || c === "\n" || c === "\t" || c === "\f" || c === "\r";
}

function characterState(char, SUCCESS){
	return function(c){
		if(c === char) this._state = SUCCESS.bind(this);
	};
}

function ifElseState(upper, SUCCESS, FAILURE){
	var lower = upper.toLowerCase();

	if(upper === lower){
		return function(c){
			if(c === lower){
				this._state = SUCCESS.bind(this);
			} else {
				this._state = FAILURE.bind(this);
				this._index--;
			}
		};
	} else {
		return function(c){
			if(c === lower || c === upper){
				this._state = SUCCESS.bind(this);
			} else {
				this._state = FAILURE.bind(this);
				this._index--;
			}
		};
	}
}

function consumeSpecialNameChar(upper, NEXT_STATE){
	var lower = upper.toLowerCase();

	return function(c){
		if(c === lower || c === upper){
			this._state = NEXT_STATE.bind(this);
		} else {
			this._state = this._stateInTagName;
			this._index--; //consume the token again
		}
	};
}

function Tokenizer(options, cbs){
	this._state = this._stateText;
	this._buffer = "";
	this._sectionStart = 0;
	this._index = 0;
	this._bufferOffset = 0; //chars removed from _buffer
	this._baseState = this._stateText;
	this._special = SPECIAL_NONE;
	this._cbs = cbs;
	this._running = true;
	this._ended = false;
	this._xmlMode = !!(options && options.xmlMode);
}

Tokenizer.prototype._stateText = function(c){
	if(c === "<"){
		if(this._index > this._sectionStart){
			this._cbs.ontext(this._getSection());
		}
		this._state = this._stateBeforeTagName;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateBeforeTagName = function(c){
	if(c === "/"){
		this._state = this._stateBeforeCloseingTagName;
	} else if(c === "<"){
		this._cbs.ontext(this._getSection());
		this._sectionStart = this._index;
	} else if(c === ">" || this._special !== SPECIAL_NONE || whitespace(c)) {
		this._state = this._stateText;
	} else if(c === "!"){
		this._state = this._stateBeforeDeclaration;
		this._sectionStart = this._index + 1;
	} else if(c === "?"){
		this._state = this._stateInProcessingInstruction;
		this._sectionStart = this._index + 1;
	} else {
		this._state = (!this._xmlMode && (c === "s" || c === "S")) ? this._stateBeforeSpecial : this._stateInTagName;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateInTagName = function(c){
	if(c === "/" || c === ">" || whitespace(c)){
		this._emitToken("onopentagname");
		this._state = this._stateBeforeAttributeName;
		this._index--;
	}
};

Tokenizer.prototype._stateBeforeCloseingTagName = function(c){
	if(whitespace(c));
	else if(c === ">"){
		this._state = this._stateText;
	} else if(this._special !== SPECIAL_NONE){
		if(c === "s" || c === "S"){
			this._state = this._stateBeforeSpecialEnd;
		} else {
			this._state = this._stateText;
			this._index--;
		}
	} else {
		this._state = this._stateInClosingTagName;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateInClosingTagName = function(c){
	if(c === ">" || whitespace(c)){
		this._emitToken("onclosetag");
		this._state = this._stateAfterClosingTagName;
		this._index--;
	}
};

Tokenizer.prototype._stateAfterClosingTagName = function(c){
	//skip everything until ">"
	if(c === ">"){
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	}
};

Tokenizer.prototype._stateBeforeAttributeName = function(c){
	if(c === ">"){
		this._cbs.onopentagend();
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	} else if(c === "/"){
		this._state = this._stateInSelfClosingTag;
	} else if(!whitespace(c)){
		this._state = this._stateInAttributeName;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateInSelfClosingTag = function(c){
	if(c === ">"){
		this._cbs.onselfclosingtag();
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	} else if(!whitespace(c)){
		this._state = this._stateBeforeAttributeName;
		this._index--;
	}
};

Tokenizer.prototype._stateInAttributeName = function(c){
	if(c === "=" || c === "/" || c === ">" || whitespace(c)){
		this._cbs.onattribname(this._getSection());
		this._sectionStart = -1;
		this._state = this._stateAfterAttributeName;
		this._index--;
	}
};

Tokenizer.prototype._stateAfterAttributeName = function(c){
	if(c === "="){
		this._state = this._stateBeforeAttributeValue;
	} else if(c === "/" || c === ">"){
		this._cbs.onattribend();
		this._state = this._stateBeforeAttributeName;
		this._index--;
	} else if(!whitespace(c)){
		this._cbs.onattribend();
		this._state = this._stateInAttributeName;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateBeforeAttributeValue = function(c){
	if(c === "\""){
		this._state = this._stateInAttributeValueDoubleQuotes;
		this._sectionStart = this._index + 1;
	} else if(c === "'"){
		this._state = this._stateInAttributeValueSingleQuotes;
		this._sectionStart = this._index + 1;
	} else if(!whitespace(c)){
		this._state = this._stateInAttributeValueNoQuotes;
		this._sectionStart = this._index;
		this._index--; //reconsume token
	}
};

Tokenizer.prototype._stateInAttributeValueDoubleQuotes = function(c){
	if(c === "\""){
		this._emitToken("onattribdata", "double_quotes");
		this._cbs.onattribend();
		this._state = this._stateBeforeAttributeName;
	}
};

Tokenizer.prototype._stateInAttributeValueSingleQuotes = function(c){
	if(c === "'"){
		this._emitToken("onattribdata", "single_quotes");
		this._cbs.onattribend();
		this._state = this._stateBeforeAttributeName;
	}
};

Tokenizer.prototype._stateInAttributeValueNoQuotes = function(c){
	if(whitespace(c) || c === ">"){
		this._emitToken("onattribdata", "no_quotes");
		this._cbs.onattribend();
		this._state = this._stateBeforeAttributeName;
		this._index--;
	}
};

Tokenizer.prototype._stateBeforeDeclaration = function(c){
	this._state = c === "[" ? this._stateBeforeCdata1 :
					c === "-" ? this._stateBeforeComment :
						this._stateInDeclaration;
};

Tokenizer.prototype._stateInDeclaration = function(c){
	if(c === ">"){
		this._cbs.ondeclaration(this._getSection());
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	}
};

Tokenizer.prototype._stateInProcessingInstruction = function(c){
	if(c === ">"){
		this._cbs.onprocessinginstruction(this._getSection());
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	}
};

Tokenizer.prototype._stateBeforeComment = function(c){
	if(c === "-"){
		this._state = this._stateInComment;
		this._sectionStart = this._index + 1;
	} else {
		this._state = this._stateInDeclaration;
	}
};

Tokenizer.prototype._stateInComment = function(c){
	if(c === "-"){
		this._state = this._stateAfterComment1;
	}
};

Tokenizer.prototype._stateAfterComment1 = function(c){
	if(c === "-"){
		this._state = this._stateAfterComment2;
	} else {
		this._state = this._stateInComment;
	}
};

Tokenizer.prototype._stateAfterComment2 = function(c){
	if(c === ">"){
		//remove 2 trailing chars
		this._cbs.oncomment(this._buffer.substring(this._sectionStart, this._index - 2));

		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	} else if(c !== "-"){
		this._state = this._stateInComment;
	}
	// else: stay in AFTER_COMMENT_2 (`--->`)
};

Tokenizer.prototype._stateBeforeCdata6 = function(c){
	if(c === "["){
		this._state = this._stateInCdata;
		this._sectionStart = this._index + 1;
	} else {
		this._state = this._stateInDeclaration;
		this._index--;
	}
};

Tokenizer.prototype._stateBeforeCdata5 = ifElseState("A", Tokenizer.prototype._stateBeforeCdata6, Tokenizer.prototype._stateInDeclaration);
Tokenizer.prototype._stateBeforeCdata4 = ifElseState("T", Tokenizer.prototype._stateBeforeCdata5, Tokenizer.prototype._stateInDeclaration);
Tokenizer.prototype._stateBeforeCdata3 = ifElseState("A", Tokenizer.prototype._stateBeforeCdata4, Tokenizer.prototype._stateInDeclaration);
Tokenizer.prototype._stateBeforeCdata2 = ifElseState("D", Tokenizer.prototype._stateBeforeCdata3, Tokenizer.prototype._stateInDeclaration);
Tokenizer.prototype._stateBeforeCdata1 = ifElseState("C", Tokenizer.prototype._stateBeforeCdata2, Tokenizer.prototype._stateInDeclaration);

Tokenizer.prototype._stateInCdata = function(c){
	if(c === "]") this._state = this._stateAfterCdata1;
};

Tokenizer.prototype._stateAfterCdata2 = function(c){
	if(c === ">"){
		//remove 2 trailing chars
		this._cbs.oncdata(this._buffer.substring(this._sectionStart, this._index - 2));
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	} else if(c !== "]") {
		this._state = this._stateInCdata;
	}
	//else: stay in AFTER_CDATA_2 (`]]]>`)
};

Tokenizer.prototype._stateAfterCdata1 = characterState("]", Tokenizer.prototype._stateAfterCdata2);


Tokenizer.prototype._stateBeforeSpecial = function(c){
	if(c === "c" || c === "C"){
		this._state = this._stateBeforeScript1;
	} else if(c === "t" || c === "T"){
		this._state = this._stateBeforeStyle1;
	} else {
		this._state = this._stateInTagName;
		this._index--; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeSpecialEnd = function(c){
	if(this._special === SPECIAL_SCRIPT && (c === "c" || c === "C")){
		this._state = this._stateAfterScript1;
	} else if(this._special === SPECIAL_STYLE && (c === "t" || c === "T")){
		this._state = this._stateAfterStyle1;
	}
	else this._state = this._stateText;
};

Tokenizer.prototype._stateBeforeScript5 = function(c){
	if(c === "/" || c === ">" || whitespace(c)){
		this._special = SPECIAL_SCRIPT;
	}
	this._state = this._stateInTagName;
	this._index--; //consume the token again
};

Tokenizer.prototype._stateBeforeScript4 = consumeSpecialNameChar("T", Tokenizer.prototype._stateBeforeScript5);
Tokenizer.prototype._stateBeforeScript3 = consumeSpecialNameChar("P", Tokenizer.prototype._stateBeforeScript4);
Tokenizer.prototype._stateBeforeScript2 = consumeSpecialNameChar("I", Tokenizer.prototype._stateBeforeScript3);
Tokenizer.prototype._stateBeforeScript1 = consumeSpecialNameChar("R", Tokenizer.prototype._stateBeforeScript2);

Tokenizer.prototype._stateAfterScript5 = function(c){
	if(c === ">" || whitespace(c)){
		this._special = SPECIAL_NONE;
		this._state = this._stateInClosingTagName;
		this._sectionStart = this._index - 6;
		this._index--; //reconsume the token
	}
	else this._state = this._stateText;
};

Tokenizer.prototype._stateAfterScript4 = ifElseState("T", Tokenizer.prototype._stateAfterScript5, Tokenizer.prototype._stateText);
Tokenizer.prototype._stateAfterScript3 = ifElseState("P", Tokenizer.prototype._stateAfterScript4, Tokenizer.prototype._stateText);
Tokenizer.prototype._stateAfterScript2 = ifElseState("I", Tokenizer.prototype._stateAfterScript3, Tokenizer.prototype._stateText);
Tokenizer.prototype._stateAfterScript1 = ifElseState("R", Tokenizer.prototype._stateAfterScript2, Tokenizer.prototype._stateText);

Tokenizer.prototype._stateBeforeStyle4 = function(c){
	if(c === "/" || c === ">" || whitespace(c)){
		this._special = SPECIAL_STYLE;
	}
	this._state = this._stateInTagName;
	this._index--; //consume the token again
};

Tokenizer.prototype._stateBeforeStyle3 = consumeSpecialNameChar("E", Tokenizer.prototype._stateBeforeStyle4);
Tokenizer.prototype._stateBeforeStyle2 = consumeSpecialNameChar("L", Tokenizer.prototype._stateBeforeStyle3);
Tokenizer.prototype._stateBeforeStyle1 = consumeSpecialNameChar("Y", Tokenizer.prototype._stateBeforeStyle2);

Tokenizer.prototype._stateAfterStyle4 = function(c){
	if(c === ">" || whitespace(c)){
		this._special = SPECIAL_NONE;
		this._state = this._stateInClosingTagName;
		this._sectionStart = this._index - 5;
		this._index--; //reconsume the token
	}
	else this._state = this._stateText;
};

Tokenizer.prototype._stateAfterStyle3 = ifElseState("E", Tokenizer.prototype._stateAfterStyle4, Tokenizer.prototype._stateText);
Tokenizer.prototype._stateAfterStyle2 = ifElseState("L", Tokenizer.prototype._stateAfterStyle3, Tokenizer.prototype._stateText);
Tokenizer.prototype._stateAfterStyle1 = ifElseState("Y", Tokenizer.prototype._stateAfterStyle2, Tokenizer.prototype._stateText);

Tokenizer.prototype._cleanup = function (){
	if(this._sectionStart < 0){
		this._buffer = "";
		this._bufferOffset += this._index;
		this._index = 0;
	} else if(this._running){
		if(this._state === this._stateText){
			if(this._sectionStart !== this._index){
				this._cbs.ontext(this._buffer.substr(this._sectionStart));
			}
			this._buffer = "";
			this._bufferOffset += this._index;
			this._index = 0;
		} else if(this._sectionStart === this._index){
			//the section just started
			this._buffer = "";
			this._bufferOffset += this._index;
			this._index = 0;
		} else {
			//remove everything unnecessary
			this._buffer = this._buffer.substr(this._sectionStart);
			this._index -= this._sectionStart;
			this._bufferOffset += this._sectionStart;
		}

		this._sectionStart = 0;
	}
};

//TODO make events conditional
Tokenizer.prototype.write = function(chunk){
	if(this._ended) this._cbs.onerror(Error(".write() after done!"));

	this._buffer += chunk;
	this._parse();
};

Tokenizer.prototype._parse = function(){
	var len = this._buffer.length;

	while(this._index < len && this._running){
		this._state(this._buffer.charAt(this._index));
		this._index++;
	}

	this._cleanup();
};

Tokenizer.prototype.pause = function(){
	this._running = false;
};
Tokenizer.prototype.resume = function(){
	this._running = true;

	if(this._index < this._buffer.length){
		this._parse();
	}
	if(this._ended){
		this._finish();
	}
};

Tokenizer.prototype.end = function(chunk){
	if(this._ended) this._cbs.onerror(Error(".end() after done!"));
	if(chunk) this.write(chunk);

	this._ended = true;

	if(this._running) this._finish();
};

Tokenizer.prototype._finish = function(){
	//if there is remaining data, emit it in a reasonable way
	if(this._sectionStart < this._index){
		this._handleTrailingData();
	}

	this._cbs.onend();
};

Tokenizer.prototype._handleTrailingData = function(){
	var data = this._buffer.substr(this._sectionStart);

	if(this._state === this._stateInCdata || this._state === this._stateAfterCdata1 || this._state === this._stateAfterCdata2){
		this._cbs.oncdata(data);
	} else if(this._state === this._stateInComment || this._state === this._stateAfterComment1 || this._state === this._stateAfterComment2){
		this._cbs.oncomment(data);
	} else if(
		this._state !== this._stateInTagName &&
		this._state !== this._stateBeforeAttributeName &&
		this._state !== this._stateBeforeAttributeValue &&
		this._state !== this._stateAfterAttributeName &&
		this._state !== this._stateInAttributeName &&
		this._state !== this._stateInAttributeValueSingleQuotes &&
		this._state !== this._stateInAttributeValueDoubleQuotes &&
		this._state !== this._stateInAttributeValueNoQuotes &&
		this._state !== this._stateInClosingTagName
	){
		this._cbs.ontext(data);
	}
	//else, ignore remaining data
	//TODO add a way to remove current tag
};

Tokenizer.prototype.reset = function(){
	Tokenizer.call(this, {xmlMode: this._xmlMode}, this._cbs);
};

Tokenizer.prototype.getAbsoluteIndex = function(){
	return this._bufferOffset + this._index;
};

Tokenizer.prototype._getSection = function(){
	return this._buffer.substring(this._sectionStart, this._index);
};

Tokenizer.prototype._emitToken = function(name, opts){
	this._cbs[name](this._getSection(), opts);
	this._sectionStart = -1;
};

Tokenizer.prototype._emitPartial = function(value){
	if(this._baseState !== this._stateText){
		this._cbs.onattribdata(value); //TODO implement the new event
	} else {
		this._cbs.ontext(value);
	}
};
