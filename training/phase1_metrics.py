"""Descriptive aggregation only; the authoritative outcomes come from TypeScript."""
import statistics
def summary(episodes):
    successes=[e for e in episodes if e.get('capture7Complete')]
    median=lambda values: statistics.median(values) if values else None
    rows=[]
    for number in range(1,11):
        map_id=f'{number:02d}';samples=[e for e in episodes if e.get('mapId')==map_id]
        good=[e for e in samples if e.get('capture7Complete')]
        rows.append({'id':map_id,'episodes':len(samples),'successes':len(good),'completionRate':len(good)/len(samples) if samples else None,
          'meanCaptures':statistics.mean(e['captureCount'] for e in samples) if samples else None,
          'medianFirstCaptureSeconds':median([e['firstCaptureSeconds'] for e in samples if e.get('firstCaptureSeconds') is not None]),
          'medianCapture7Seconds':median([e['capture7Seconds'] for e in good]),'timeouts':sum(e['result']['reason']=='timeout' for e in samples)})
    return {'episodeCount':len(episodes),'capture7CompletionRate':len(successes)/len(episodes) if episodes else None,
      'meanCaptures':statistics.mean(e['captureCount'] for e in episodes) if episodes else None,
      'medianFirstCaptureSeconds':median([e['firstCaptureSeconds'] for e in episodes if e.get('firstCaptureSeconds') is not None]),
      'medianCapture7Seconds':median([e['capture7Seconds'] for e in successes]),'timeouts':sum(e['result']['reason']=='timeout' for e in episodes),
      'motion':{key:sum(e.get('motion',{}).get(key,0) for e in episodes) for key in ['effectiveWindows','idleWindows','spinningWindows','totalWindows','blockedTicks']},'perMap':rows}
