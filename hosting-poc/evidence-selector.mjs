export const MAX_SELECTOR_CANDIDATES=48;
export const MAX_SELECTOR_SOURCES=6;


/*
 * A valid selector response can cover some parts while leaving others empty.
 * In that case, use only already-retrieved candidates explicitly linked to an
 * uncovered part. These links are retrieval leads, not semantic support
 * judgments; the caller records them separately and the claim reviewer still
 * decides whether any citation supports the answer.
 */
export function recoverUncoveredPartCandidates(decision,candidates){
  const parts=Array.isArray(decision?.parts)?decision.parts:[];
  const candidateRows=Array.isArray(candidates)?candidates:[];
  const selectedCandidateIds=[...new Set(Array.isArray(decision?.selectedCandidateIds)?
    decision.selectedCandidateIds.filter(id=>typeof id==='string'):[])];
  const modelSelected=new Set(selectedCandidateIds);
  const recoveredSet=new Set();
  const recoveredPartLinks=[];
  const skippedPartRecoveries=[];
  for(const part of parts){
    const partId=String(part?.partId||'');
    const evidence=Array.isArray(part?.evidence)?part.evidence:[];
    const hasDirectEvidence=evidence.some(item=>item?.support==='direct');
    const hasEvidenceDecision=Array.isArray(part?.evidence);
    const legacyHasCandidates=!hasEvidenceDecision&&Array.isArray(part?.candidateIds)&&
      part.candidateIds.length>0;
    if(!partId||hasDirectEvidence||legacyHasCandidates)continue;
    const eligible=candidateRows.filter(row=>typeof row?.id==='string'&&
      Array.isArray(row.retrievedPartHints)&&row.retrievedPartHints.includes(partId));
    // Reuse a page already in the six-page packet before adding another one.
    // A retrieval hint only restores the missing part-to-page handoff; it does
    // not turn the selector's context/omission into a support judgment.
    const candidate=eligible.find(row=>modelSelected.has(row.id))||
      eligible.find(row=>recoveredSet.has(row.id))||eligible[0];
    if(!candidate){
      skippedPartRecoveries.push({partId,reason:'no-part-linked-candidate'});
      continue;
    }
    const alreadyRecovered=recoveredSet.has(candidate.id);
    if(!modelSelected.has(candidate.id)&&!alreadyRecovered&&
       selectedCandidateIds.length>=MAX_SELECTOR_SOURCES){
      skippedPartRecoveries.push({partId,reason:'six-page-packet-limit'});
      continue;
    }
    if(!modelSelected.has(candidate.id)&&!alreadyRecovered){
      selectedCandidateIds.push(candidate.id);
      recoveredSet.add(candidate.id);
    }
    recoveredPartLinks.push({partId,candidateId:candidate.id,
      reason:'retrieved-part-hint'});
  }
  return {selectedCandidateIds,recoveredPartLinks,skippedPartRecoveries};
}

/* Keep a small, retrieval-linked packet for every planned part even when the
 * selector omits that part. Hints are only admission cues: downstream review
 * still decides whether a selected page supports any claim. */
export function enforcePartPacketFloor(decision,candidates){
  const parts=Array.isArray(decision?.parts)?decision.parts:[];
  const rows=Array.isArray(candidates)?candidates:[];
  const selected=[...new Set(Array.isArray(decision?.selectedCandidateIds)?
    decision.selectedCandidateIds.filter(id=>typeof id==='string'):[])];
  const byId=new Map(rows.map(row=>[row.id,row]));
  const partCount=parts.length;
  const floor=Math.min(2,Math.max(1,Math.floor(MAX_SELECTOR_SOURCES/Math.max(1,partCount))));
  const reserved=new Set(parts.map(part=>part?.candidateIds?.[0]).filter(Boolean));
  const direct=new Set(parts.flatMap(part=>(part?.evidence||[])
    .filter(entry=>entry?.support==='direct').map(entry=>entry.candidateId)));
  const floorLinks=[],packetFloorLinks=[];
  const skipped=[];
  const countFor=partId=>selected.filter(id=>
    byId.get(id)?.retrievedPartHints?.includes(partId)).length;
  for(const part of parts){
    const partId=String(part?.partId||'');
    if(!partId)continue;
    for(const id of selected.filter(candidateId=>byId.get(candidateId)?.retrievedPartHints?.includes(partId))
      .slice(0,floor))packetFloorLinks.push({partId,candidateId:id});
    while(countFor(partId)<floor){
      const candidate=rows.find(row=>typeof row?.id==='string'&&
        row.retrievedPartHints?.includes(partId)&&!selected.includes(row.id));
      if(!candidate){
        if(countFor(partId)<floor)skipped.push({partId,reason:'no-part-linked-candidate'});
        break;
      }
      let displaced=null;
      if(selected.length>=MAX_SELECTOR_SOURCES){
        const fill=selected.find(id=>{
          if(reserved.has(id)||direct.has(id))return false;
          const linkedParts=parts.filter(value=>byId.get(id)?.retrievedPartHints?.includes(value.partId));
          return linkedParts.every(value=>countFor(value.partId)-1>=floor);
        });
        if(!fill){skipped.push({partId,candidateId:candidate.id,reason:'no-displaceable-fill'});break;}
        displaced=fill;
        selected.splice(selected.indexOf(fill),1);
      }
      selected.push(candidate.id);
      const link={partId,candidateId:candidate.id};
      packetFloorLinks.push(link);
      floorLinks.push({...link,...(displaced?{displacedCandidateId:displaced}:{})});
    }
  }
  return {selectedCandidateIds:selected,packetFloor:{added:floorLinks,skipped},floor,
    packetFloorLinks};
}

/* Batch 34 (B34-4): duplicate-bookId bar + facet representation at the
 * Worker selector layer. Batch 33's B33-7(b) diversity lived only in
 * the client's baseline selector (boundAnswerSources); the harness/live
 * path's submitted sources are chosen HERE, and batch 33's record at
 * this layer was: OpenStax 593 twice in both Ambition passes, Hersey
 * 580 twice in phase-3 Solitude, Sonya's facet-top pages (436: rank 1
 * in three facets, the pool's highest score) passed over in C&P SP2
 * while all six slots went to other facets' pages. The batch-34 probe
 * (batch34-probe-results.md) classified Sonya/Proust/Solitude as
 * selection-stage and Darcy's letter as candidate-stage (it leaves
 * this item for the query-generation work).
 * Two bounded sub-passes over the selector's chosen set; neither adds
 * a page beyond the shared cap and neither displaces a page the
 * representation rules protect:
 * (1) Duplicate-bookId bar (pools with >= 2 distinct books): a second
 * page of an already-chosen book defers its slot — first to an
 * unsubmitted candidate of an unrepresented facet-top / part-top
 * book, then to any unsubmitted distinct-book candidate, in pool
 * order. B33-7(b)'s precedence is preserved: when the duplicate's
 * book is part-linked, it does not yield to a book with no part
 * linkage at all. Deferred pages refill leftover slots.
 * (2) Facet-top page representation (pools carrying facetRanks): a
 * facet's rank-1 page that the selector passed over displaces the
 * last chosen page that is expendable — not itself a facet-top page,
 * not a book's sole chosen representative (multi-book pools), and
 * not a part's sole chosen linked page. Targets are ordered by
 * facet multiplicity (a page topping several facets is the pool's
 * consensus strongest), then facet order, then pool order.
 * Facet-top books / pages that still miss the set are traced in
 * selectionDroppedFacets (the B33-7(b) trace shape, emitted by the
 * Worker path), with the client's reason taxonomy for book-level
 * drops and 'packet-filled-with-facet-tops' for page-level drops.
 * When no candidate carries facetRanks, part-top books (each part's
 * earliest pool-order linked candidate) are the representation
 * targets and sub-pass (2) does not run — in scoped single-book
 * pools part links do not discriminate (every page links every
 * part), which the checkpoint records as this layer's known limit. */
export function enforceSubmittedBookDiversity(selectedCandidateIds,candidates,
 {limit=MAX_SELECTOR_SOURCES,partIds=[]}={}){
  const rows=(Array.isArray(candidates)?candidates:[])
    .filter(row=>row&&typeof row.id==='string');
  const rowById=new Map(rows.map(row=>[row.id,row]));
  const bookOf=row=>String(row?.bookId||'');
  const linksOf=row=>[...new Set([
    ...(Array.isArray(row?.candidatePartIds)?row.candidatePartIds:[]),
    ...(Array.isArray(row?.retrievedPartHints)?row.retrievedPartHints:[])])];
  const selected=[...new Set((Array.isArray(selectedCandidateIds)?selectedCandidateIds:[])
    .filter(id=>typeof id==='string'))];
  // Facet tops: per facet, the candidate holding the smallest rank
  // (first in pool order wins a tie) — the client's facetTopBooks
  // semantics, kept at both book and page level.
  const facetTopPage=new Map();
  for(const row of rows){
    if(!Array.isArray(row.facetRanks))continue;
    for(const entry of row.facetRanks){
      if(!entry||!Number.isFinite(entry.rank))continue;
      const current=facetTopPage.get(entry.facet);
      if(!current||entry.rank<current.rank)
        facetTopPage.set(entry.facet,{row,rank:entry.rank});
    }
  }
  const facetOrder=(left,right)=>{
    const a=Number(left),b=Number(right);
    if(Number.isFinite(a)&&Number.isFinite(b))return a-b;
    return String(left).localeCompare(String(right),undefined,{numeric:true});
  };
  const sortedFacets=[...facetTopPage.keys()].sort(facetOrder);
  const targetBooks=[],targetBookSeen=new Set();
  const addTargetBook=(bookId,via)=>{
    if(bookId&&!targetBookSeen.has(bookId)){
      targetBookSeen.add(bookId);targetBooks.push({bookId,via});
    }
  };
  for(const facet of sortedFacets)
    addTargetBook(bookOf(facetTopPage.get(facet).row),{facet});
  const partOrder=[...(Array.isArray(partIds)?partIds:[])];
  if(!partOrder.length)
    for(const row of rows)for(const partId of linksOf(row))
      if(!partOrder.includes(partId))partOrder.push(partId);
  for(const partId of partOrder){
    const topRow=rows.find(row=>linksOf(row).includes(partId));
    if(topRow)addTargetBook(bookOf(topRow),{partId});
  }
  const poolBooks=new Set(rows.map(bookOf).filter(Boolean));
  const linkedBooks=new Set(rows.filter(row=>linksOf(row).length)
    .map(bookOf).filter(Boolean));
  const inserted=[];
  let chosen=[...selected],deferred=[];
  // Sub-pass (1): the duplicate-bookId bar.
  if(poolBooks.size>=2){
    const selectedSet=new Set(selected);
    const representedBySelection=new Set(selected
      .map(id=>bookOf(rowById.get(id))).filter(Boolean));
    const pendingTargetBooks=new Set(targetBooks
      .filter(target=>!representedBySelection.has(target.bookId))
      .map(target=>target.bookId));
    const fillPool=rows.filter(row=>!selectedSet.has(row.id));
    const usedFill=new Set();
    const chosenBooks=new Set();
    const takeFill=duplicateBook=>{
      const pools=[fillPool.filter(row=>pendingTargetBooks.has(bookOf(row))),fillPool];
      for(const pool of pools){
        const fill=pool.find(row=>{
          const book=bookOf(row);
          if(!book||chosenBooks.has(book)||usedFill.has(row.id))return false;
          // B33-7(b) precedence: a part-linked duplicate does not
          // yield to a book with no part linkage at all.
          if(linkedBooks.has(duplicateBook)&&!linkedBooks.has(book))return false;
          return true;
        });
        if(fill)return fill;
      }
      return null;
    };
    const next=[];
    for(const id of selected){
      const book=bookOf(rowById.get(id));
      if(book&&chosenBooks.has(book)){
        const fill=takeFill(book);
        if(fill){
          usedFill.add(fill.id);
          next.push(fill.id);chosenBooks.add(bookOf(fill));
          inserted.push({candidateId:fill.id,bookId:bookOf(fill),
            displacedCandidateId:id,reason:'duplicate-book-slot'});
          deferred.push(id);
          continue;
        }
        next.push(id);
        continue;
      }
      next.push(id);
      if(book)chosenBooks.add(book);
    }
    for(const id of deferred){
      if(next.length>=limit)break;
      if(!next.includes(id))next.push(id);
    }
    deferred=deferred.filter(id=>!next.includes(id));
    chosen=next;
  }
  // Sub-pass (2): facet-top page representation.
  const droppedPages=[];
  if(facetTopPage.size){
    const facetTopIds=new Set([...facetTopPage.values()].map(({row})=>row.id));
    const pageFacets=new Map();
    for(const [facet,{row}] of facetTopPage){
      const list=pageFacets.get(row.id)||[];
      list.push(facet);pageFacets.set(row.id,list);
    }
    const pageTargets=[...pageFacets.entries()]
      .filter(([id])=>!chosen.includes(id))
      .map(([id,facets])=>({candidateId:id,
        facets:[...facets].sort(facetOrder),bookId:bookOf(rowById.get(id))}))
      .sort((left,right)=>right.facets.length-left.facets.length||
        facetOrder(left.facets[0],right.facets[0])||
        rows.indexOf(rowById.get(left.candidateId))-
          rows.indexOf(rowById.get(right.candidateId)));
    for(const target of pageTargets){
      let displacedIndex=-1;
      for(let index=chosen.length-1;index>=0;index--){
        const id=chosen[index];
        if(facetTopIds.has(id))continue;
        const row=rowById.get(id);
        if(!row)continue;
        const book=bookOf(row);
        // B33-7(b) precedence, applied to pages: a facet-top page of
        // a book with no part linkage does not displace a part-linked
        // book's page (the Proust pass-1 shape, held at both layers).
        if(book&&!linkedBooks.has(target.bookId)&&linkedBooks.has(book))continue;
        if(poolBooks.size>=2){
          if(book&&chosen.filter(other=>bookOf(rowById.get(other))===book)
            .length<=1)continue;
        }
        const soleLink=linksOf(row).some(partId=>chosen.every(other=>
          other===id||!linksOf(rowById.get(other)).includes(partId)));
        if(soleLink)continue;
        displacedIndex=index;
        break;
      }
      if(displacedIndex<0){droppedPages.push(target);continue;}
      const [displaced]=chosen.splice(displacedIndex,1);
      chosen.splice(displacedIndex,0,target.candidateId);
      inserted.push({candidateId:target.candidateId,bookId:target.bookId,
        displacedCandidateId:displaced,reason:'facet-top-page',
        facets:target.facets});
    }
  }
  const finalBooks=new Map();
  for(const id of chosen){
    const book=bookOf(rowById.get(id));
    if(book)finalBooks.set(book,(finalBooks.get(book)||0)+1);
  }
  const duplicateRemains=[...finalBooks.values()].some(count=>count>=2);
  const selectionDroppedFacets=[];
  for(const target of targetBooks){
    if(finalBooks.has(target.bookId))continue;
    selectionDroppedFacets.push({
      ...(target.via.facet!==undefined?{facet:target.via.facet}:{partId:target.via.partId}),
      bookId:target.bookId,
      reason:duplicateRemains?'duplicate-book-slot-used':'packet-filled-with-distinct-books'});
  }
  // A facet whose top BOOK already missed is recorded once, at book
  // level; page-level records cover the facets whose book made the
  // set but whose top page did not.
  const bookDroppedFacets=new Set(selectionDroppedFacets
    .map(entry=>entry.facet).filter(facet=>facet!==undefined));
  for(const target of droppedPages)
    for(const facet of target.facets){
      if(bookDroppedFacets.has(facet))continue;
      selectionDroppedFacets.push({facet,bookId:target.bookId,
        page:rowById.get(target.candidateId)?.page,
        reason:'packet-filled-with-facet-tops'});
    }
  selectionDroppedFacets.sort((left,right)=>
    String(left.facet??left.partId).localeCompare(
      String(right.facet??right.partId),undefined,{numeric:true}));
  return {selectedCandidateIds:chosen,
    ...(inserted.length?{diversityInserted:inserted}:{}),
    ...(deferred.length?{diversityDeferred:deferred}:{}),
    selectionDroppedFacets};
}

/* Stage B (B1a): facet-anchor reservation for deterministic
 * packing. B34-4's diversity pass represents facet-top pages by
 * DISPLACEMENT, late in the chain, and only against expendable
 * pages; the phase-3 Darcy case showed a facet's anchor page can
 * still miss the packet when the round-robin fill takes the slots
 * first (a single-book pool degenerates the round-robin to pool
 * order). Reservation runs the other way: each facet's rank-1 page
 * is SEEDED into the selected set before the round-robin filling,
 * so the fill spends its remaining slots around the anchors.
 * Targets are ordered by facet multiplicity (a page topping
 * several facets is the pool's consensus strongest, B34-4's
 * ordering), then facet order, then pool order. The reservation
 * is driven only by the facet ranks the retrieval record carries;
 * when the pool carries no facetRanks the reservation is empty
 * and says so — the eval harness's current submissions carry
 * none, which the trace records honestly instead of the mechanism
 * pretending to fire. Part-linkage filtering and the submitted
 * bookkeeping are the caller's (it owns the plan); statuses here
 * are 'reserved' or 'cap-deferred'. */
export function facetAnchorReservations(candidates,{limit=MAX_SELECTOR_SOURCES}={}){
  const rows=(Array.isArray(candidates)?candidates:[])
    .filter(row=>row&&typeof row.id==='string');
  const facetTopPage=new Map();
  for(const row of rows){
    if(!Array.isArray(row.facetRanks))continue;
    for(const entry of row.facetRanks){
      if(!entry||!Number.isFinite(entry.rank))continue;
      const current=facetTopPage.get(entry.facet);
      if(!current||entry.rank<current.rank)
        facetTopPage.set(entry.facet,{row,rank:entry.rank});
    }
  }
  if(!facetTopPage.size)return {hasFacetRanks:false,seedCandidateIds:[],reservations:[]};
  const facetOrder=(left,right)=>{
    const a=Number(left),b=Number(right);
    if(Number.isFinite(a)&&Number.isFinite(b))return a-b;
    return String(left).localeCompare(String(right),undefined,{numeric:true});
  };
  const pageFacets=new Map();
  for(const [facet,{row}] of facetTopPage){
    const list=pageFacets.get(row.id)||[];
    list.push(facet);pageFacets.set(row.id,list);
  }
  const rowById=new Map(rows.map(row=>[row.id,row]));
  const targets=[...pageFacets.entries()]
    .map(([candidateId,facets])=>({candidateId,
      facets:[...facets].sort(facetOrder),row:rowById.get(candidateId)}))
    .sort((left,right)=>right.facets.length-left.facets.length||
      facetOrder(left.facets[0],right.facets[0])||
      rows.indexOf(left.row)-rows.indexOf(right.row));
  const seedCandidateIds=[],reservations=[];
  for(const target of targets){
    let status;
    if(seedCandidateIds.includes(target.candidateId))status='reserved';
    else if(seedCandidateIds.length<limit){
      seedCandidateIds.push(target.candidateId);status='reserved';
    }else status='cap-deferred';
    const partIds=[...new Set([
      ...(Array.isArray(target.row?.candidatePartIds)?target.row.candidatePartIds:[]),
      ...(Array.isArray(target.row?.retrievedPartHints)?target.row.retrievedPartHints:[])])];
    for(const facet of target.facets)
      reservations.push({facet,candidateId:target.candidateId,
        ...(partIds.length?{partIds}:{}),status});
  }
  reservations.sort((left,right)=>facetOrder(left.facet,right.facet));
  return {hasFacetRanks:true,seedCandidateIds,reservations};
}

export function orderPacketForPacking(selectedCandidateIds,parts,packetFloorLinks=[]){
  const selected=[...new Set(Array.isArray(selectedCandidateIds)?selectedCandidateIds:[])];
  const planParts=Array.isArray(parts)?parts:[];
  const protectedIds=new Set([
    ...planParts.map(part=>part?.candidateIds?.[0]).filter(Boolean),
    ...planParts.flatMap(part=>(part?.evidence||[]).filter(entry=>entry?.support==='direct')
      .map(entry=>entry.candidateId))
  ]);
  const flooredIds=new Set((Array.isArray(packetFloorLinks)?packetFloorLinks:[])
    .map(link=>link?.candidateId).filter(Boolean));
  return [...selected.filter(id=>protectedIds.has(id)),
    ...selected.filter(id=>flooredIds.has(id)&&!protectedIds.has(id)),
    ...selected.filter(id=>!protectedIds.has(id)&&!flooredIds.has(id))];
}

/* A selector outage still needs a bounded packet. Round-robin across works
 * preserves source breadth from the retrieval ranking without claiming that
 * those fallback pages passed semantic selection. */
export function orderFallbackCandidates(candidates,partIds=[]){
  const byBook=new Map(),ordered=[];
  const values=Array.isArray(candidates)?candidates:[];
  const hintedPartIds=Array.isArray(partIds)&&partIds.length?partIds:[...new Set(values.flatMap(value=>
    Array.isArray(value?.candidatePartIds)?value.candidatePartIds:
      Array.isArray(value?.retrievedPartHints)?value.retrievedPartHints:[]))];
  const candidateKeys=new Map(values.map((candidate,index)=>[
    candidate,typeof candidate?.id==='string'&&candidate.id?candidate.id:
      String(candidate?.bookId||'')+':'+String(candidate?.page||'')+':'+index]));
  const selected=new Set();
  // Retrieval links are hints rather than proof, but they let an outage
  // fallback reserve a page for each part when the bounded pool has one.
  for(const partId of hintedPartIds){
    const candidate=values.find(value=>{
      const hints=Array.isArray(value?.candidatePartIds)?value.candidatePartIds:
        Array.isArray(value?.retrievedPartHints)?value.retrievedPartHints:[];
      return hints.includes(partId)&&!selected.has(candidateKeys.get(value));
    });
    if(candidate){ordered.push(candidate);selected.add(candidateKeys.get(candidate));}
  }
  for(const candidate of values){
    if(selected.has(candidateKeys.get(candidate)))continue;
    const bookId=String(candidate?.bookId||'');
    const key=bookId||'__unidentified__';
    const pages=byBook.get(key)||[];
    pages.push(candidate);
    byBook.set(key,pages);
  }
  const maxPages=Math.max(0,...[...byBook.values()].map(pages=>pages.length));
  for(let depth=0;depth<maxPages;depth++){
    let added=false;
    for(const [bookId,pages] of byBook){
      if(depth>=pages.length)continue;
      const candidate=pages[depth];
      if(selected.has(candidateKeys.get(candidate)))continue;
      ordered.push(candidate);selected.add(candidateKeys.get(candidate));added=true;
    }
    if(!added)break;
  }
  return ordered;
}

/* Stage B.5 (item 1): the selection exclusion ledger. Record-only —
 * nothing here feeds back into selection. For every pooled candidate
 * that does not reach the packet, name the stage that left it out, in
 * the order the stages actually decide: the decision's own packet-cap
 * overflow first, then packing's byte rejections, the packet floor's
 * and the diversity pass's displacements and deferrals, recoveries the
 * packet budget skipped, and finally the rows no part ever linked.
 * Packed rows, and rows merged into a packed duplicate, are not
 * exclusions and never appear. */
export function selectionExclusionLedger({candidateIds=[],packedIds=[],mergedIds=[],
  droppedCandidateIds=[],packingRejections=[],packetFloor=null,diversityInserted=[],
  diversityDeferred=[],recoverySkips=[],linkedIds=[]}={}){
  const packed=new Set(packedIds),merged=new Set(mergedIds),linked=new Set(linkedIds);
  const dropped=new Map((droppedCandidateIds||[])
    .map(entry=>[entry?.candidateId,entry?.reason]));
  const rejected=new Map((packingRejections||[])
    .map(entry=>[entry?.candidateId,entry?.reason]));
  const floorDisplaced=new Set((packetFloor?.added||[])
    .map(entry=>entry?.displacedCandidateId).filter(Boolean));
  const diversityDisplaced=new Set((diversityInserted||[])
    .map(entry=>entry?.displacedCandidateId).filter(Boolean));
  const deferred=new Set(diversityDeferred||[]);
  const budgetSkipped=new Set();
  for(const skip of recoverySkips||[]){
    if(skip?.reason!=='answer-packet-budget')continue;
    for(const id of Array.isArray(skip?.candidateIds)?skip.candidateIds:
      skip?.candidateId?[skip.candidateId]:[])budgetSkipped.add(id);
  }
  const excluded=[];
  for(const id of candidateIds||[]){
    if(packed.has(id)||merged.has(id))continue;
    const reason=dropped.get(id)||rejected.get(id)||
      (floorDisplaced.has(id)?'displaced-by-packet-floor':null)||
      (diversityDisplaced.has(id)?'displaced-by-diversity':null)||
      (deferred.has(id)?'diversity-deferred':null)||
      (budgetSkipped.has(id)?'answer-packet-budget':null)||
      (linked.has(id)?'not-selected':'no-part-link');
    excluded.push({id,reason});
  }
  return excluded;
}

// Direct-representation swaps (repair tranche) were removed after
// their validation: 14 firings run-wide, no measured benefit, and
// one documented harm — a swap evicted the Darcy letter's
// continuation page (P&P p.120) for an aboutness page. The repaired
// linkage signal in public-gateway.mjs stays; only the swap
// consequence is retired.
