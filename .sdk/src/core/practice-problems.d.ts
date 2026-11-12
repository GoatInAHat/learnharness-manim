/** The native common practice pose fields, shared unchanged by plugin poses. */
import { Type } from "typebox";
export declare const practiceProblemInputSchema: Type.TObject<{
    statement: Type.TString;
    mode: Type.TUnion<[Type.TLiteral<"recall">, Type.TLiteral<"discrimination">, Type.TLiteral<"composition">]>;
    target: Type.TOptional<Type.TArray<Type.TString>>;
    modelSolution: Type.TString;
}>;
