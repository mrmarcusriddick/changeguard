import { test } from "node:test";
import assert from "node:assert/strict";
import { collectMock, scoreEvidence, makePlan } from "../lib/engine.ts";
test("SERVER17 known dependency contributions total 58 with 20 uncertainty",()=>{
 const evidence=collectMock("SERVER17");const score=scoreEvidence(evidence);
 assert.equal(score.score,78);assert.equal(score.dependency,58);assert.equal(score.uncertainty,20);assert.equal(score.readiness,"BLOCKED");assert.equal(score.coverage,86);
 assert.deepEqual(scoreEvidence(collectMock("SERVER17")),score);
});
test("missing evidence remains unknown and cannot imply low risk or readiness",()=>{
 const evidence=collectMock("LAB02");const score=scoreEvidence(evidence);
 assert.ok(evidence.every(e=>e.status==="unknown"));assert.equal(score.level,"UNRESOLVED");assert.equal(score.readiness,"UNRESOLVED");assert.equal(score.coverage,0);assert.equal(score.dependency,0);assert.equal(score.uncertainty,30);
 assert.equal(scoreEvidence([]).readiness,"UNRESOLVED");
});
test("caps are bounded, input order independent, observed absence is not inferred",()=>{
 const evidence=collectMock("SERVER17");assert.deepEqual(scoreEvidence(evidence).score,scoreEvidence([...evidence].reverse()).score);
 assert.ok(scoreEvidence([...evidence,...evidence,...evidence]).score<=100);
 const unknown={...evidence[0],status:"unknown" as const};assert.equal(scoreEvidence([unknown]).dependency,0);
});
test("plans preserve constraints, unresolved collection, validation and rollback without execution",()=>{
 const plan=makePlan("SERVER17",collectMock("SERVER17"),"Ops","Saturday","No permanent deletion");
 assert.equal(plan.constraints,"No permanent deletion");assert.equal(plan.executionPerformed,false);
 assert.ok(plan.steps.some(s=>s.phase==="Rollback"));assert.ok(plan.steps.some(s=>s.phase==="Evidence collection"));assert.ok(plan.steps.every(s=>s.validation.length>0));
});
test("unknown assets are rejected",()=>assert.throws(()=>collectMock("OTHER")));
