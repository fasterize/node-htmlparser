module.exports = Stream;

var Parser = require("./WritableStream.js");

var Stream = function(options){
	Parser.call(this, new cbs(this), options);
};

require("util").inherits(Stream, require("stream"));

Stream.prototype.readable = true;

function Cbs(scope){
	this.scope = scope;
}

cbs.prototype = {
	oncdataend: function(){
		this.scope.emit("cdataend");
	},
	oncdatastart: function(){
		this.scope.emit("cdatastart");
	},
	onclosetag: function(name){
    	this.scope.emit("closetag", name);
    },
	oncomment: function(text){
    	this.scope.emit("comment", text);
    },
	oncommentend: function(){
		this.scope.emit("commentend");
	},
	onerror: function(err){
    	this.scope.emit("error", err);
    },
	onopentag: function(name, attribs, type){
    	this.scope.emit("opentag", name, attribs, type);
    },
    onopentagname: function(name){
    	this.scope.emit("opentagname", name);
    },
    onattribute: function(name, value){
    	this.scope.emit("attribute", name, value);
    },
	onprocessinginstruction: function(name, data){
		this.scope.emit("processinginstruction", name, data);
	},
	onreset: function(){
		this.scope.emit("reset");
	},
    ontext: function(text){
    	this.scope.emit("text", text);
    	//let the 'pipe' function do something useful
    	//this.scope.emit("data", text);
    }
};

module.exports = Stream;