module.exports = Tokenizer;

var	j = 0,

		SPECIAL_NONE                        = j++,
		SPECIAL_SCRIPT                       = j++,
		SPECIAL_STYLE                        = j++;

function whitespace(c){
	return c === " " || c === "\n" || c === "\t" || c === "\f";
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
	this._options = options;
	this._special = 0; // 1 for script, 2 for style
	this._cbs = cbs;
	this._running = true;
	this._reconsume = false;
	this._xmlMode = this._options && this._options.xmlMode;
}

Tokenizer.prototype._stateText = function(c){
	if(c === "<"){
		if(this._index > this._sectionStart){
			this._cbs.ontext(this._getSection());
		}
		this._state = BEFORE_TAG_NAME;
		this._sectionStart = this._index;
	} else if(this._decodeEntities && c === "&"){
		if(this._index > this._sectionStart){
			this._cbs.ontext(this._getSection());
		}
		this._baseState = TEXT;
		this._state = BEFORE_ENTITY;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateBeforeTagName = function(c){
	if(c === "/"){
		this._state = this._stateBeforeCloseingTagName;
	} else if(c === ">" || this._special !== SPECIAL_NONE || whitespace(c)) {
		this._state = this._stateText;
	} else if(c === "!"){
		this._state = this._stateBeforeDeclaration;
		this._sectionStart = this._index + 1;
	} else if(c === "?"){
		this._state = this._stateInProcessingInstruction;
		this._sectionStart = this._index + 1;
	} else if(c === "<"){
		this._cbs.ontext(this._getSection());
		this._sectionStart = this._index;
	} else {
		this._state = (!this._xmlMode && (c === "s" || c === "S")) ? this._stateBeforeSpecial : this._stateInTagName;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateInTagName = function (c) {
	if(c === "/"){
		this._emitToken("onopentagname");
		this._cbs.onselfclosingtag();
		this._state = AFTER_CLOSING_TAG_NAME;
	} else if(c === ">"){
		this._cbs.onopentagname(this._getSection());
		this._cbs.onopentagend();
		this._state = TEXT;
		this._sectionStart = this._index + 1;
	} else if(whitespace(c)){
		this._emitToken("onopentagname");
		this._state = BEFORE_ATTRIBUTE_NAME;
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
			this._state = TEXT;
			this._reconsume = true;
		}
	} else {
		this._state = this._stateInClosingTagName;
		this._sectionStart = this._index;
	}
};

Tokenizer.prototype._stateInCloseingTagName = function (c) {
	if(c === ">"){
		this._cbs.onclosetag(this._getSection());
		this._state = TEXT;
		this._sectionStart = this._index + 1;
		this._special = SPECIAL_NONE;
	} else if(whitespace(c)){
		this._emitToken("onclosetag");
		this._state = AFTER_CLOSING_TAG_NAME;
		this._special = SPECIAL_NONE;
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
		this._state = TEXT;
		this._sectionStart = this._index + 1;
	} else if(c === "/"){
		this._cbs.onselfclosingtag();
		this._state = AFTER_CLOSING_TAG_NAME;
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
		if(this._index > this._sectionStart){
			this._cbs.onattribname(this._getSection());
		}
		this._sectionStart = -1;
		this._state = AFTER_ATTRIBUTE_NAME;
		this._reconsume = true;
	}
};

Tokenizer.prototype._stateAfterAttributeName = function(c){
	if(c === "="){
		this._state = this._stateBeforeAttributeValue;
	} else if(c === "/" || c === ">"){
		this._cbs.onattribend();
		this._state = BEFORE_ATTRIBUTE_NAME;
		this._reconsume = true;
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

Tokenizer.prototype._stateInAttributeValueNoQuotes = function (c) {
	if(c === ">"){
		this._cbs.onattribvalue(this._getSection());
		this._state = TEXT;
		this._cbs.onopentagend();
		this._sectionStart = this._index + 1;
	} else if(whitespace(c)){
		this._emitToken("onattribvalue");
		this._state = BEFORE_ATTRIBUTE_NAME;
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
	} else if(c === "-") {
		this._state = this._stateinCloseConditionalComment1;
	}
};

Tokenizer.prototype._stateinCloseConditionalComment1 = function(c){
	if(c === "-"){
		this._state = this._stateinCloseConditionalComment2;
	} else {
		this._state = this._stateInDeclaration;
	}
};

Tokenizer.prototype._stateinCloseConditionalComment2 = function(c){
	if(c === ">"){
		this._cbs.oncloseconditionalcomment(this._buffer.substring(this._sectionStart, this._index - 2));
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	} else {
		this._state = this._stateInDeclaration;
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
		this._state = this._stateInCommentOrConditionalComment;
		this._sectionStart = this._index + 1;
	} else {
		this._state = this._stateInDeclaration;
	}
};

Tokenizer.prototype._stateInCommentOrConditionalComment = function(c){
	if(whitespace(c));
	else if(c === "["){
		this._state = this._stateInOpenConditionalComment;
		this._sectionStart = this._index;
	} else if(c === ">") {
		this._cbs.ontext("<!-->");
		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	} else if(c === "-"){
		this._state = this._stateAfterComment1;
	} else {
		this._state = this._stateInComment;
	}
};

Tokenizer.prototype._stateInOpenConditionalComment = function(c){
	if((this._index - this._sectionStart === 3) && this._getSection() !== "[if") {
		this._state = this._stateInComment;
	} else if(c === ">"){
		this._state = this._stateInEndOpenConditionalComment;
	}
};

Tokenizer.prototype._stateInEndOpenConditionalComment = function(c){
	if(whitespace(c));
	else if(c === "-"){
		this._state = this._stateAfterComment1;
	} else {
		var data = this._getSection();
		this._index -= data.length - data.lastIndexOf(">");
		this._cbs.onopenconditionalcomment(this._getSection());
		this._state = this._stateText;
		this._sectionStart = this._index + 1 ;
	}
};

Tokenizer.prototype._stateInComment = function(c){
	if(c === "-"){
		this._state = this._stateAfterComment1;
	}
};

Tokenizer.prototype._stateAfterComment1 = function (c) {
	if(c === "-") this._state = AFTER_COMMENT_2;
	else this._state = IN_COMMENT;
};

Tokenizer.prototype._stateAfterComment2 = function(c){
	if(c === ">"){
		//remove 2 trailing chars
		// if <![endif] is inside, so it's a close conditional comment
		var data = this._buffer.substring(this._sectionStart, this._index - 2);
		if(data.indexOf("<![endif]") !== -1){
			this._cbs.oncloseconditionalcomment( "--" + data);
		} else if( /\[\s*if[^\]]*\]/.test(data)){
			this._cbs.onopenconditionalcomment( data + "--");
		} else {
			this._cbs.oncomment(data);
		}

		this._state = this._stateText;
		this._sectionStart = this._index + 1;
	} else if(c !== "-"){
		this._state = this._stateInComment;
	}
	// else: stay in AFTER_COMMENT_2 (`--->`)
};

Tokenizer.prototype._stateBeforeCdata1 = function (c) {
	if(c === "C") this._state = BEFORE_CDATA_2;
	else this._state = IN_DECLARATION;
};

Tokenizer.prototype._stateBeforeCdata2 = function (c) {
	if(c === "D") this._state = BEFORE_CDATA_3;
	else this._state = IN_DECLARATION;
};

Tokenizer.prototype._stateBeforeCdata3 = function (c) {
	if(c === "A") this._state = BEFORE_CDATA_4;
	else this._state = IN_DECLARATION;
};

Tokenizer.prototype._stateBeforeCdata4 = function (c) {
	if(c === "T") this._state = BEFORE_CDATA_5;
	else this._state = IN_DECLARATION;
};

Tokenizer.prototype._stateBeforeCdata5 = function (c) {
	if(c === "A") this._state = BEFORE_CDATA_6;
	else this._state = IN_DECLARATION;
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

Tokenizer.prototype._stateAfterCdata1 = function (c) {
	if(c === "]") this._state = AFTER_CDATA_2;
	else this._state = IN_CDATA;
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
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeSpecialEnd = function (c) {
	this._state = (this._special === SPECIAL_SCRIPT && (c === "c" || c === "C")) ?
		AFTER_SCRIPT_1 : (this._special === SPECIAL_STYLE && (c === "t" || c === "T")) ?
			AFTER_STYLE_1 : TEXT;
};

Tokenizer.prototype._stateBeforeScript1 = function (c) {
	if(c === "r" || c === "R"){
		this._state = BEFORE_SCRIPT_2;
	} else {
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeScript2 = function (c) {
	if(c === "i" || c === "I"){
		this._state = BEFORE_SCRIPT_3;
	} else {
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeScript3 = function (c) {
	if(c === "p" || c === "P"){
		this._state = BEFORE_SCRIPT_4;
	} else {
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
	else this._state = this._stateText;
};

Tokenizer.prototype._stateBeforeScript4 = function (c) {
	if(c === "t" || c === "T"){
		this._state = BEFORE_SCRIPT_5;
	} else {
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeScript5 = function(c){
	if(c === "/" || c === ">" || whitespace(c)){
		this._special = SPECIAL_SCRIPT;
	}
	this._state = IN_TAG_NAME;
	this._reconsume = true; //consume the token again
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
		this._reconsume = true; //reconsume the token
	}
	else this._state = this._stateText;
};

Tokenizer.prototype._stateBeforeStyle1 = function (c) {
	if(c === "y" || c === "Y"){
		this._state = BEFORE_STYLE_2;
	} else {
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeStyle2 = function (c) {
	if(c === "l" || c === "L"){
		this._state = BEFORE_STYLE_3;
	} else {
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeStyle3 = function (c) {
	if(c === "e" || c === "E"){
		this._state = BEFORE_STYLE_4;
	} else {
		this._state = IN_TAG_NAME;
		this._reconsume = true; //consume the token again
	}
};

Tokenizer.prototype._stateBeforeStyle4 = function(c){
	if(c === "/" || c === ">" || whitespace(c)){
		this._special = SPECIAL_STYLE;
	}
	this._state = IN_TAG_NAME;
	this._reconsume = true; //consume the token again
};

Tokenizer.prototype._stateBeforeStyle3 = consumeSpecialNameChar("E", Tokenizer.prototype._stateBeforeStyle4);
Tokenizer.prototype._stateBeforeStyle2 = consumeSpecialNameChar("L", Tokenizer.prototype._stateBeforeStyle3);
Tokenizer.prototype._stateBeforeStyle1 = consumeSpecialNameChar("Y", Tokenizer.prototype._stateBeforeStyle2);

Tokenizer.prototype._stateAfterStyle4 = function(c){
	if(c === ">" || whitespace(c)){
		this._special = SPECIAL_NONE;
		this._state = this._stateInClosingTagName;
		this._sectionStart = this._index - 5;
		this._reconsume = true; //reconsume the token
	}
	else this._state = this._stateText;
};

Tokenizer.prototype._stateAfterStyle3 = ifElseState("E", Tokenizer.prototype._stateAfterStyle4, Tokenizer.prototype._stateText);
Tokenizer.prototype._stateAfterStyle2 = ifElseState("L", Tokenizer.prototype._stateAfterStyle3, Tokenizer.prototype._stateText);
Tokenizer.prototype._stateAfterStyle1 = ifElseState("Y", Tokenizer.prototype._stateAfterStyle2, Tokenizer.prototype._stateText);

Tokenizer.prototype._cleanup = function () {
  if(this._sectionStart === -1){
		this._buffer = "";
		this._index = 0;
		this._bufferOffset += this._index;
	} else if(this._running){
		if(this._state === this._stateText){
			if(this._sectionStart !== this._index){
				this._cbs.ontext(this._buffer.substr(this._sectionStart));
			}
			this._buffer = "";
			this._index = 0;
			this._bufferOffset += this._index;
		} else if(this._sectionStart === this._index){
			//the section just started
			this._buffer = "";
			this._index = 0;
		} else if(this._sectionStart > 0){
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
	this._buffer += chunk;
	this._parse();
};

Tokenizer.prototype._parse = function(){
	while(this._index < this._buffer.length && this._running){
		var c = this._buffer.charAt(this._index);
		if(this._state === TEXT){
			if(c === "<"){
				this._emitIfToken("text");
				this._state = TAG_START;
				if(this._special > 0){
					//save the position
					this._sectionStart = this._index;
				}
			}
		} else if(this._state === BEFORE_TAG_NAME){
			if(c === "/"){
				this._state = BEFORE_CLOSING_TAG_NAME;
			} else if(c === ">" || this._special > 0 || whitespace(c)) {
				this._state = TEXT;
			} else {
				if(whitespace(c));
				else if(c === "!"){
					this._state = BEFORE_DECLARATION;
					this._sectionStart = this._index + 1;
				} else if(c === "?"){
					this._state = IN_PROCESSING_INSTRUCTION;
					this._sectionStart = this._index + 1;
				} else if(
					!(this._options && this._options.xmlMode) &&
					(c === "s" || c === "S")
				){
					this._state = BEFORE_SPECIAL;
					this._sectionStart = this._index;
				} else {
					this._state = IN_TAG_NAME;
					this._sectionStart = this._index;
				}
			}
			//TODO handle ">"
			//TODO remove redundant else
		} else if(this._state === IN_TAG_NAME){
			if(c === "/"){
				this._emitToken("opentagname");
				this._cbs.onopentagend();
				this._cbs.onselfclosingtag();
				this._state = AFTER_CLOSING_TAG_NAME;
			} else if(c === ">"){
				this._emitToken("opentagname");
				this._state = TEXT;
				this._sectionStart = this._index + 1;
			} else if(whitespace(c)){
				this._emitToken("onopentagname");
				this._state = BEFORE_ATTRIBUTE_NAME;
			}
		} else if(this._state === BEFORE_CLOSING_TAG_NAME){
			if(whitespace(c));
			else if(this._special > 0){
				if(c === code("s") || c === code("S")){
					this._state = SPECIAL_END;
				}
			} else {
				this._state = IN_CLOSING_TAG_NAME;
				this._sectionStart = this._index;
			}
			// TODO handle ">"
		} else if(this._state === IN_CLOSING_TAG_NAME){
			this._stateInCloseingTagName(c);
		} else if(this._state === AFTER_CLOSING_TAG_NAME){
			this._stateAfterCloseingTagName(c);
		} else if(this._state === IN_SELF_CLOSING_TAG){
			this._stateInSelfClosingTag(c);
		}

		/*
		*	attributes
		*/
		else if(this._state === BEFORE_ATTRIBUTE_NAME){
			if(c === ">"){
				this._state = TEXT;
				this._sectionStart = this._index + 1;
			} else if(c === "/"){
				this._cbs.onopentagend();
				this._cbs.onselfclosingtag();
				this._state = AFTER_CLOSING_TAG_NAME;
			} else if(!whitespace(c)){
				this._state = IN_ATTRIBUTE_NAME;
				this._sectionStart = this._index;
			}
		} else if(this._state === IN_ATTRIBUTE_NAME){
			if(c === "="){
				this._emitIfToken("onattribname");
				this._state = BEFORE_ATTRIBUTE_VALUE;
			} else if(c === "/"){
				this._emitIfToken("attribname");
				this._cbs.onopentagend();
				this._cbs.onselfclosingtag();
				this._state = AFTER_CLOSING_TAG_NAME;
			} else if(c === ">"){
				this._emitIfToken("attribname");
				this._state = TEXT;
				this._sectionStart = this._index + 1;
			} else if(whitespace(c)){
				this._emitIfToken("onattribname");
				this._state = AFTER_ATTRIBUTE_NAME;
			} else if(c === "/" || c === ">"){
				this._emitIfToken("onattribname");
				this._state = BEFORE_ATTRIBUTE_NAME;
				continue;
			}
		} else if(this._state === AFTER_ATTRIBUTE_NAME){
			if(c === "="){
				this._state = BEFORE_ATTRIBUTE_VALUE;
			} else if(c === "/"){
				this._cbs.onopentagend();
				this._cbs.onselfclosingtag();
				this._state = AFTER_CLOSING_TAG_NAME;
			} else if(c === ">"){
				this._state = TEXT;
				this._sectionStart = this._index + 1;
			} else if(!whitespace(c)){
				this._state = IN_ATTRIBUTE_NAME;
				this._sectionStart = this._index;
			}
		} else if(this._state === BEFORE_ATTRIBUTE_VALUE){
			this._stateBeforeAttributeValue(c);
		} else if(this._state === IN_ATTRIBUTE_VALUE_DQ){
			this._stateInAttributeValueDoubleQuotes(c);
		} else if(this._state === IN_ATTRIBUTE_VALUE_SQ){
			this._stateInAttributeValueSingleQuotes(c);
		} else if(this._state === IN_ATTRIBUTE_VALUE_NO_QUOTES){
			if(c === ">"){
				this._emitToken("onattribvalue");
				this._state = TEXT;
				this._sectionStart = this._index + 1;
			} else if(whitespace(c)){
				this._emitToken("onattribvalue");
				this._state = BEFORE_ATTRIBUTE_NAME;
			}
		}

		/*
		*	declarations
		*/
		else if(this._state === BEFORE_DECLARATION){
			this._stateBeforeDeclaration(c);
		} else if(this._state === IN_DECLARATION){
			this._stateInDeclaration(c);
		}

		/*
		*	processing instructions
		*/
		else if(this._state === IN_PROCESSING_INSTRUCTION){
			this._stateInProcessingInstruction(c);
		}

		/*
		*	comments
		*/
		else if(this._state === BEFORE_COMMENT){
			this._stateBeforeComment(c);
		} else if(this._state === IN_COMMENT){
			this._stateInComment(c);
		} else if(this._state === IN_COMMENT_OR_CONDITIONAL_COMMENT){
			this._stateInCommentOrConditionalComment(c);
		} else if(this._state === IN_OPEN_CONDITIONAL_COMMENT){
			this._stateInOpenConditionalComment(c);
		} else if(this._state === IN_CLOSE_CONDITIONAL_COMMENT_1){
			this._stateinCloseConditionalComment1(c);
		} else if(this._state === IN_CLOSE_CONDITIONAL_COMMENT_2){
			this._stateinCloseConditionalComment2(c);
		} else if(this._state === AFTER_COMMENT_1){
			this._stateAfterComment1(c);
		} else if(this._state === AFTER_COMMENT_2){
			this._stateAfterComment2(c);
		}

		/*
		*	cdata
		*/
		else if(this._state === BEFORE_CDATA_1){
			this._stateBeforeCdata1(c);
		} else if(this._state === BEFORE_CDATA_2){
			this._stateBeforeCdata2(c);
		} else if(this._state === BEFORE_CDATA_3){
			this._stateBeforeCdata3(c);
		} else if(this._state === BEFORE_CDATA_4){
			this._stateBeforeCdata4(c);
		} else if(this._state === BEFORE_CDATA_5){
			this._stateBeforeCdata5(c);
		} else if(this._state === BEFORE_CDATA_6){
			this._stateBeforeCdata6(c);
		} else if(this._state === IN_CDATA){
			this._stateInCdata(c);
		} else if(this._state === AFTER_CDATA_1){
			this._stateAfterCdata1(c);
		} else if(this._state === AFTER_CDATA_2){
			this._stateAfterCdata2(c);
		}

		/*
		* special tags
		*/
		else if(this._state === BEFORE_SPECIAL){
			this._stateBeforeSpecial(c);
		} else if(this._state === BEFORE_SPECIAL_END){
			this._stateBeforeSpecialEnd(c);
		}

		/*
		* script
		*/
		else if(this._state === BEFORE_SCRIPT_1){
			this._stateBeforeScript1(c);
		} else if(this._state === BEFORE_SCRIPT_2){
			this._stateBeforeScript2(c);
		} else if(this._state === BEFORE_SCRIPT_3){
			this._stateBeforeScript3(c);
		} else if(this._state === BEFORE_SCRIPT_4){
			this._stateBeforeScript4(c);
		} else if(this._state === BEFORE_SCRIPT_5){
			this._stateBeforeScript5(c);
		}

		else if(this._state === AFTER_SCRIPT_1){
			this._stateAfterScript1(c);
		} else if(this._state === AFTER_SCRIPT_2){
			this._stateAfterScript2(c);
		} else if(this._state === AFTER_SCRIPT_3){
			this._stateAfterScript3(c);
		} else if(this._state === AFTER_SCRIPT_4){
			this._stateAfterScript4(c);
		} else if(this._state === AFTER_SCRIPT_5){
			this._stateAfterScript5(c);
		}

		/*
		* style
		*/
		else if(this._state === BEFORE_STYLE_1){
			this._stateBeforeStyle1(c);
		} else if(this._state === BEFORE_STYLE_2){
			this._stateBeforeStyle2(c);
		} else if(this._state === BEFORE_STYLE_3){
			this._stateBeforeStyle3(c);
		} else if(this._state === BEFORE_STYLE_4){
			this._stateBeforeStyle4(c);
		}

		else if(this._state === AFTER_STYLE_1){
			this._stateAfterStyle1(c);
		} else if(this._state === AFTER_STYLE_2){
			this._stateAfterStyle2(c);
		} else if(this._state === AFTER_STYLE_3){
			this._stateAfterStyle3(c);
		} else if(this._state === AFTER_STYLE_4){
			this._stateAfterStyle4(c);
		}

		/*
		* entities
		*/
		else if(this._state === BEFORE_ENTITY){
			this._stateBeforeEntity(c);
		} else if(this._state === BEFORE_NUMERIC_ENTITY){
			this._stateBeforeNumericEntity(c);
		} else if(this._state === IN_NAMED_ENTITY){
			this._stateInNamedEntity(c);
		} else if(this._state === IN_NUMERIC_ENTITY){
			this._stateInNumericEntity(c);
		} else if(this._state === IN_HEX_ENTITY){
			this._stateInHexEntity(c);
		}

		else {
			this._cbs.onerror(Error("unknown _state"), this._state);
		}

		if (this._reconsume) {
    		this._reconsume = false;
		} else {
			this._index++;
		}
	}

	//cleanup
	if(this._sectionStart === -1){
		this._buffer = null;
	} else {
		this._sectionStart = 0;

		if(this._sectionStart === this._index - 1){
			this._buffer = null;
		} else {
			this._buffer = this._buffer.slice(this._sectionStart);
		}
	}
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
	Tokenizer.call(this, this._options, this._cbs);
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
