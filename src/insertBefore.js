/*
	Define node methods to insert a given statement so that it is executed
	immediately before some subnode.

	Usage example:
		For the code
			// jstyper start import z
			var x = 5;
			var y = z = true, x = z;
		We must check that z is a number immediately before "x = z". Say this is 
		represented by an AST_VarDef 'vd', and the AST_Var representing 
		"var y = z = true, x = z" node 'v'. Generate a new statement 's' 
		representing the type check. We would then do:
			v.insertBefore(s, vd);
		resulting in:
			var x = 5;
			var y = z = true;
			{{s}};
			var x = z;

		The optional 3rd parameter is a boolean - if it is true, the node 'target'
		will also be deleted from the parent. For example, in the situation above,
		we would need to delete the original node 'v' from the body and replace it
		by the two separate halves.
*/

var UglifyJS = require("uglify-js2");

function parent(par) {
	return function() { return par; };
}

UglifyJS.AST_Node.prototype.insertBefore = function() {
	throw new Error("insertBefore not implemented yet...");			
};

UglifyJS.AST_Constant.prototype.insertBefore = noSubchildren;

UglifyJS.AST_SymbolRef.prototype.insertBefore = noSubchildren;

UglifyJS.AST_Binary.prototype.insertBefore = function(newNode, target, del) {
	if (del) throw new Error("Can't delete subnode here");

	// assuming left-to-right evaluation

	if (target === this.left) {
		// left is evaluated first, so we can insert before this whole expression
		return this.parent().insertBefore(newNode, this);
	} else if (target === this.right) {
		// wrap the RHS in an IIFE which runs newNode before returning the value of RHS
		this.right = getIIFE(newNode, this.right);
		this.right.parent = parent(this);
		return [];
	} else {
		throw new Error("target is not a subnode");
	}
};

UglifyJS.AST_Assign.prototype.insertBefore = function(newNode, target, del) {
	if (del) throw new Error("Can't delete subnode here");

	if (target === this.left) {
		// wrap the value with an IIFE which runs the new node before returning the expression value
		this.right = getIIFE(newNode, this.left);
		this.right.parent = parent(this);
		return [];
	} else if (target === this.right) {
		// RHS is executed first, so can safely execute before the whole assignment
		return this.parent().insertBefore(newNode, this);
	} else {
		throw new Error("target is not a subnode");
	}
};

UglifyJS.AST_SimpleStatement.prototype.insertBefore = function(newNode, target, del) {
	if (target === this.body) {
		return this.parent().insertBefore(newNode, this, del);
	} else {
		throw new Error("target is not a subnode");
	}
};

UglifyJS.AST_EmptyStatement.prototype.insertBefore = noSubchildren;

// e.g. var ___x=y+z___;
UglifyJS.AST_VarDef.prototype.insertBefore = function(newNode, target, del) {
	if (del) throw new Error("Can't delete subnode here");
	if (target === this.name) {
		// wrap the value with an IIFE which check's the identifier's type before returning
		this.value = getIIFE(newNode, this.value);
		this.value.parent = parent(this); 
		return [];
	} else if (target === this.value) {
		return this.parent().insertBefore(newNode, this);
	} else {
		throw new Error("target is not a subnode");
	}
};

// e.g ___var x, y=z+1, p=true___;
UglifyJS.AST_Var.prototype.insertBefore = function(newStatement, target, del) {
	// we need to split the list of vardefs into two, and insert in between them
	
	var pos = this.definitions.indexOf(target);
	if (pos < 0) throw new Error("target is not a subnode");
	
	var preVarDefs = this.definitions.slice(0, pos);
	var preVar = new UglifyJS.AST_Var({
		definitions: preVarDefs
	});
	var deleted = [];
	if (del) {
		deleted.push({
			from:this.definitions[pos],
			to: newStatement
		});
		pos += 1; // skip the VarDef we want to delete
	}
	var postVarDefs = this.definitions.slice(pos);
	var postVar = new UglifyJS.AST_Var({
		definitions: postVarDefs
	});

	// reallocate parents
	preVar.parent = parent(this);
	postVar.parent = parent(this);
	for (var i =0; i<preVarDefs.length; i++) {
		preVarDefs[i].parent = parent(preVar);
	}
	for (var j =0; j<postVarDefs.length; j++) {
		postVarDefs[j].parent = parent(postVar);
	}
	
	if (preVar.definitions.length > 0)
		deleted = deleted.concat(this.parent().insertBefore(preVar, this));

	deleted = deleted.concat(this.parent().insertBefore(newStatement, this));

	if (postVar.definitions.length > 0)
		deleted = deleted.concat(this.parent().insertBefore(postVar, this, true));

	return deleted;
};

UglifyJS.AST_Toplevel.prototype.insertBefore = function(newStatement, target, del) {
	var pos = this.body.indexOf(target);
	if (pos < 0) throw new Error("target is not a subnode");
	var deleted = this.body.splice(pos, del?1:0, newStatement);
	newStatement.parent = parent(this);
	if (del) {
		return [{from: deleted[0], to: newStatement}];
	} else {
		return [];
	}
};



/*************** HELPER FUNCTIONS ***************/


function noSubchildren() {
	throw new Error("Cannot insert before this node type");
}


// TODO: Assign parents to everything in here
function getIIFE(newStatement, expression) {
	return new UglifyJS.AST_Call({
		expression: new UglifyJS.AST_Function({
			argnames:[
				new UglifyJS.AST_SymbolFunarg({
					name: 't'
				})
			],
			body: [
				newStatement,
				new UglifyJS.AST_Return({
					value: new UglifyJS.AST_SymbolRef({
						name: 't'
					})
				})
			]
		}),
		args:[
			expression
		]
	});
}