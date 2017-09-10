import * as ts from "typescript";
import * as SimpleAst from "ts-simple-ast";
import { TsSimpleAst } from "ts-simple-ast";
import { KSLangSchema as ks } from "./KSLangSchema";

function flattenArray<T>(arrays: T[][]): T[] {
    return [].concat.apply([], arrays);
}

export class TypeScriptParser {
    ast: TsSimpleAst;

    constructor() {
        this.ast = new (SimpleAst.TsSimpleAst || SimpleAst["default"])();
    }

    static parseFile(sourceCode: string, filePath?: string): ks.SchemaFile {
        const parser = new TypeScriptParser();
        parser.ast.addSourceFileFromText(filePath || "main.ts", sourceCode);
        parser.ast.addSourceFileFromText("/node_modules/typescript/lib/lib.d.ts", "");
        const sourceFile = parser.ast.getSourceFiles()[0];
        const schema = parser.createSchemaFromSourceFile(sourceFile);
        return schema;
    }

    logNodeError(message: string, node?: Node) {
        console.warn(message, node);
    }

    nameToKS(name: string, node?: Node) {
        let result = "";
        for (let c of name) {
            if ("A" <= c && c <= "Z")
                result += (result === "" ? "" : "_") + c.toLowerCase();
            else if("a" <= c && c <= "z" || c === "_" || "0" <= c && c <= "9")
                result += c;
            else
                this.logNodeError(`Invalid character ('${c}') in name: ${name}.`, node);
        }
        return result;
    }

    convertTsType(tsType: ts.Type) {
        const result = <ks.Type> { };

        const typeText = (<any>tsType).intrinsicName || tsType.symbol.name;
        if (typeText === "number")
            result.type = ks.PrimitiveType.Int32;
        else if (typeText === "string")
            result.type = ks.PrimitiveType.String;
        else if (typeText === "boolean")
            result.type = ks.PrimitiveType.Boolean;
        else if (typeText === "void")
            result.type = ks.PrimitiveType.Void;
        else {
            const isArray = typeText === "Array";
            result.type = isArray ? ks.PrimitiveType.Array : 
                ks.PrimitiveType.Class;
            
            if(!isArray)
                result.className = this.nameToKS(typeText);

            const typeArgs = <ts.Type[]>(<any>tsType).typeArguments;
            if (typeArgs)
                result.typeArguments = typeArgs.map(x => this.convertTsType(x));
        }

        return result;
    }

    convertParameter(tsParam: SimpleAst.ParameterDeclaration) {
        return <ks.MethodParameter> {
            name: this.nameToKS(tsParam.getName()),
            type: this.convertTsType(tsParam.getType().compilerType)
        };
    }

    convertExpression(tsExpr: ts.Expression): ks.Expression {
        if (typeof tsExpr === "undefined") return undefined;

        if (tsExpr.kind === ts.SyntaxKind.CallExpression) {
            const callExpr = <ts.CallExpression> tsExpr;
            return <ks.CallExpression> {
                type: ks.ExpressionType.Call,
                method: this.convertExpression(callExpr.expression),
                arguments: callExpr.arguments.map(arg => this.convertExpression(arg))
            };
        } else if (tsExpr.kind === ts.SyntaxKind.BinaryExpression) {
            const binaryExpr = <ts.BinaryExpression> tsExpr;
            return <ks.BinaryExpression> {
                type: ks.ExpressionType.Binary,
                left: this.convertExpression(binaryExpr.left),
                right: this.convertExpression(binaryExpr.right),
                operator: binaryExpr.operatorToken.getText()
            };
        } else if (tsExpr.kind === ts.SyntaxKind.PropertyAccessExpression) {
            const propAccessExpr = <ts.PropertyAccessExpression> tsExpr;
            return <ks.PropertyAccessExpression> {
                type: ks.ExpressionType.PropertyAccess,
                object: this.convertExpression(propAccessExpr.expression),
                propertyName: this.convertExpression(propAccessExpr.name)
            };
        } else if (tsExpr.kind === ts.SyntaxKind.ElementAccessExpression) {
            const elementAccessExpr = <ts.ElementAccessExpression> tsExpr;
            return <ks.PropertyAccessExpression> {
                type: ks.ExpressionType.PropertyAccess,
                object: this.convertExpression(elementAccessExpr.expression),
                propertyName: this.convertExpression(elementAccessExpr.argumentExpression)
            };
        } else if (tsExpr.kind === ts.SyntaxKind.Identifier) {
            const identifier = <ts.Identifier> tsExpr;
            return <ks.Identifier> { 
                type: ks.ExpressionType.Identifier,
                text: identifier.text
            };
        } else if (tsExpr.kind === ts.SyntaxKind.NewExpression) {
            const newExpr = <ts.NewExpression> tsExpr;
            return <ks.NewExpression> { 
                type: ks.ExpressionType.New,
                class: this.convertExpression(newExpr.expression),
                arguments: newExpr.arguments.map(arg => this.convertExpression(arg))
            };
        } else if (tsExpr.kind === ts.SyntaxKind.ConditionalExpression) {
            const condExpr = <ts.ConditionalExpression> tsExpr;
            return <ks.ConditionalExpression> { 
                type: ks.ExpressionType.Conditional,
                condition: this.convertExpression(condExpr.condition),
                whenTrue: this.convertExpression(condExpr.whenTrue),
                whenFalse: this.convertExpression(condExpr.whenFalse),
            };
        } else if (tsExpr.kind === ts.SyntaxKind.StringLiteral) {
            const literalExpr = <ts.StringLiteral> tsExpr;
            return <ks.Literal> {
                type: ks.ExpressionType.Literal,
                literalType: "string",
                value: literalExpr.text
            };
        } else if (tsExpr.kind === ts.SyntaxKind.NumericLiteral) {
            const literalExpr = <ts.NumericLiteral> tsExpr;
            return <ks.Literal> {
                type: ks.ExpressionType.Literal,
                literalType: "numeric",
                value: literalExpr.text
            };
        } else if (tsExpr.kind === ts.SyntaxKind.FalseKeyword || tsExpr.kind === ts.SyntaxKind.TrueKeyword) {
            return <ks.Literal> { 
                type: ks.ExpressionType.Literal,
                literalType: "boolean",
                value: tsExpr.getText()
            };
        } else if (tsExpr.kind === ts.SyntaxKind.NullKeyword) {
            return <ks.Literal> { 
                type: ks.ExpressionType.Literal,
                literalType: "null",
                value: "null"
            };
        } else if (tsExpr.kind === ts.SyntaxKind.ParenthesizedExpression) {
            const parenExpr = <ts.ParenthesizedExpression> tsExpr;
            return <ks.ParenthesizedExpression> { 
                type: ks.ExpressionType.Parenthesized,
                expression: this.convertExpression(parenExpr.expression)
            };
        } else if (tsExpr.kind === ts.SyntaxKind.PostfixUnaryExpression) {
            const unaryExpr = <ts.PostfixUnaryExpression> tsExpr;
            return <ks.UnaryExpression> { 
                type: ks.ExpressionType.Unary,
                unaryType: "postfix",
                operator: 
                    unaryExpr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : 
                    unaryExpr.operator === ts.SyntaxKind.MinusMinusToken ? "--" : null,
                operand: this.convertExpression(unaryExpr.operand)
            };
        } else if (tsExpr.kind === ts.SyntaxKind.PrefixUnaryExpression) {
            const unaryExpr = <ts.PrefixUnaryExpression> tsExpr;
            return <ks.UnaryExpression> { 
                type: ks.ExpressionType.Unary,
                unaryType: "prefix",
                operator: 
                    unaryExpr.operator === ts.SyntaxKind.PlusPlusToken ? "++" : 
                    unaryExpr.operator === ts.SyntaxKind.MinusMinusToken ? "--" : 
                    unaryExpr.operator === ts.SyntaxKind.PlusToken ? "+" : 
                    unaryExpr.operator === ts.SyntaxKind.MinusToken ? "-" : 
                    unaryExpr.operator === ts.SyntaxKind.TildeToken ? "~" : 
                    unaryExpr.operator === ts.SyntaxKind.ExclamationToken ? "!" : null,
                operand: this.convertExpression(unaryExpr.operand)
            };
        } else if (tsExpr.kind === ts.SyntaxKind.ArrayLiteralExpression) {
            const expr = <ts.ArrayLiteralExpression> tsExpr;
            return <ks.ArrayLiteralExpression> { 
                type: ks.ExpressionType.ArrayLiteral,
                items: expr.elements.map(x => this.convertExpression(x))
            };
        } else {
            const kindName = ts.SyntaxKind[tsExpr.kind];
            const knownKeywords = ["this", "super"];
            const keyword = knownKeywords.find(x => kindName.toLowerCase() === `${x}keyword`);
            if (keyword) {
                return <ks.Identifier> {
                    type: ks.ExpressionType.Identifier,
                    text: keyword
                };
            } else {
                this.logNodeError(`Unexpected expression kind "${ts.SyntaxKind[tsExpr.kind]}".`); 
                return null;
            }
        }
    }

    convertVariableDeclaration(varDecl: ts.VariableDeclaration): ks.VariableDeclaration {
        return <ks.VariableDeclaration> {
            type: ks.StatementType.Variable,
            variableName: varDecl.name.getText(),
            initializer: this.convertExpression(varDecl.initializer)
        };
    }

    convertInitializer(initializer: ts.ForInitializer): ks.VariableDeclaration {
        let itemVariable;
        if (initializer.kind === ts.SyntaxKind.VariableDeclarationList) {
            const varDeclList = <ts.VariableDeclarationList> initializer;
            if (varDeclList.declarations.length !== 1)
                this.logNodeError(`Multiple declarations are not supported as for of initializers.`);
            itemVariable = this.convertVariableDeclaration(varDeclList.declarations[0]);
        } else
            this.logNodeError(`${ts.SyntaxKind[initializer.kind]} is not supported yet as for of initializer.`);

        return itemVariable;
    }

    convertStatement(tsStatement: ts.Statement): ks.Statement[] {
        if (typeof tsStatement === "undefined") return undefined;

        let ksStmt: ks.Statement = null;
        let ksStmts: ks.Statement[] = null;

        if (tsStatement.kind === ts.SyntaxKind.IfStatement) {
            const ifStatement = <ts.IfStatement> tsStatement;
            ksStmt = <ks.IfStatement> {
                type: ks.StatementType.If,
                condition: this.convertExpression(ifStatement.expression),
                then: this.convertBlock(ifStatement.thenStatement),
                else: this.convertBlock(ifStatement.elseStatement),
            };
        } else if (tsStatement.kind === ts.SyntaxKind.ReturnStatement) {
            const returnStatement = <ts.ReturnStatement> tsStatement;
            ksStmt = <ks.ReturnStatement> {
                type: ks.StatementType.Return,
                expression: this.convertExpression(returnStatement.expression),
            };
        } else if (tsStatement.kind === ts.SyntaxKind.ThrowStatement) {
            const throwStatement = <ts.ReturnStatement> tsStatement;
            ksStmt = <ks.ThrowStatement> {
                type: ks.StatementType.Throw,
                expression: this.convertExpression(throwStatement.expression),
            };
        } else if (tsStatement.kind === ts.SyntaxKind.ExpressionStatement) {
            const expressionStatement = <ts.ExpressionStatement> tsStatement;
            ksStmt = <ks.ExpressionStatement> {
                type: ks.StatementType.Expression,
                expression: this.convertExpression(expressionStatement.expression),
            };
        } else if (tsStatement.kind === ts.SyntaxKind.VariableStatement) {
            const variableStatement = <ts.VariableStatement> tsStatement;
            ksStmts = variableStatement.declarationList.declarations.map(x => this.convertVariableDeclaration(x));
        } else if (tsStatement.kind === ts.SyntaxKind.WhileStatement) {
            const whileStatement = <ts.WhileStatement> tsStatement;
            ksStmt = <ks.WhileStatement> {
                type: ks.StatementType.While,
                condition: this.convertExpression(whileStatement.expression),
                body: this.convertBlock(<ts.Block>whileStatement.statement),
            };
        } else if (tsStatement.kind === ts.SyntaxKind.ForOfStatement) {
            const stmt = <ts.ForOfStatement> tsStatement;
            ksStmt = <ks.ForeachStatement> {
                type: ks.StatementType.Foreach,
                itemVariable: this.convertInitializer(stmt.initializer),
                items: this.convertExpression(stmt.expression),
                body: this.convertBlock(stmt.statement)
            };
    } else if (tsStatement.kind === ts.SyntaxKind.ForStatement) {
            const stmt = <ts.ForStatement> tsStatement;
            ksStmt = <ks.ForStatement> {
                type: ks.StatementType.For,
                itemVariable: this.convertInitializer(stmt.initializer),
                condition: this.convertExpression(stmt.condition),
                incrementor: this.convertExpression(stmt.incrementor),
                body: this.convertBlock(stmt.statement)                
            };
        } else
            this.logNodeError(`Unexpected statement kind "${ts.SyntaxKind[tsStatement.kind]}".`);

        return ksStmts || [ksStmt];
    }

    convertBlock(tsBlock: ts.BlockLike|ts.Statement): ks.Block {
        if (typeof tsBlock === "undefined") return undefined;

        if ("statements" in tsBlock)
            return { statements: flattenArray((<ts.BlockLike>tsBlock).statements.map(x => this.convertStatement(x))) };
        else
            return { statements: this.convertStatement(<ts.Statement>tsBlock) };
    }

    createSchemaFromSourceFile(typeInfo: SimpleAst.SourceFile): ks.SchemaFile {
        const schema = <ks.SchemaFile> { enums: {}, classes: {} };
        
        for (const tsEnum of typeInfo.getEnums()) {
            schema.enums[this.nameToKS(tsEnum.getName())] = <ks.Enum> { 
                values: tsEnum.getMembers().map(tsEnumMember => ({ name: this.nameToKS(tsEnumMember.getName()) }))
            };
        }

        for (const tsClass of typeInfo.getClasses()) {
            const classSchema = schema.classes[this.nameToKS(tsClass.getName())] = <ks.Class> { fields: { }, methods: { } };
            
            for (const tsProp of tsClass.getInstanceProperties()) {
                if (!(tsProp instanceof SimpleAst.PropertyDeclaration) && !(tsProp instanceof SimpleAst.ParameterDeclaration))
                    continue;

                const fieldSchema = classSchema.fields[this.nameToKS(tsProp.getName())] = <ks.Field> { 
                    type: this.convertTsType(tsProp.getType().compilerType),
                    visibility: tsProp.getScope() === "public" ? ks.Visibility.Public : 
                        tsProp.getScope() === "protected" ? ks.Visibility.Protected : 
                        ks.Visibility.Private,
                };

                const initializer = tsProp.getInitializer();
                if (initializer)
                    fieldSchema.defaultValue = initializer.getText();
            }

            for (const tsMethod of tsClass.getInstanceMethods()) {
                const methodSchema = classSchema.methods[this.nameToKS(tsMethod.getName())] = <ks.Method> { };
                methodSchema.returns = this.convertTsType(tsMethod.getReturnType().compilerType);
                methodSchema.parameters = tsMethod.getParameters().map(tsParam => this.convertParameter(tsParam));
                methodSchema.body = this.convertBlock(<ts.BlockLike> tsMethod.getBody().compilerNode);
            }

            const constructors = tsClass.getConstructors();
            if (constructors.length > 0)
                classSchema.constructor = { 
                    parameters: constructors[0].getParameters().map(tsParam => this.convertParameter(tsParam)),
                    body: this.convertBlock(<ts.BlockLike> constructors[0].getBody().compilerNode),
                };
        }
        return schema;
    }
}
