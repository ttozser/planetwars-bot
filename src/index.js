exports.handleRequest = (req, resp) => {
    
    if (!req.body.gameState) return;

    var request = JSON.stringify(req.body);
    for (var i = 0; i < request.length; i+=4000) {
        console.log("request " +  req.body.gameState.id + " : " + request.substr(i, Math.min(i+4000, request.length)));
    }

    var planets = normalizeOwners(req.body.gameState.planets, req.query.player);
    var fleets = normalizeOwners(req.body.gameState.fleets || [], req.query.player);
    
    console.log("original prediction: " + JSON.stringify(recalculatePlanetStates(planets, fleets)) + "\ngame: " +  req.body.gameState.id );
    var commands = calculateCommands(planets, fleets)
    console.log("final prediction: " + JSON.stringify(planets)+ "\ngame: " +  req.body.gameState.id);

    console.log("turn: " + req.body.gameState.turn + " commands: " + JSON.stringify(commands) + "\ngame: " +  req.body.gameState.id );
    resp.status(200);
    resp.type('application/json');
    resp.send({"commands": commands});
}

function normalizeOwners(hasOwners, player) {
    hasOwners.forEach(hasOwner => normalizeOwner(hasOwner, player));
    return hasOwners;
}

function normalizeOwner(hasOwner, player) {
    switch (hasOwner.owner) {
        case player:
        case 'player':
            hasOwner.owner = 'player';
            break;
        case 'NEUTRAL':
        case 'neutral':
            hasOwner.owner = 'neutral';
            break;
        default:
            hasOwner.owner = 'enemy';            
    }
}

function calculateCommands(planets, fleets) {
    var commands = [];
    for (;;) {
        var command = calculateNextCommand(planets, fleets);
        if (!command) break;
        commands.push(command);

        // update the state
        var sourcePlanet = getPlanet(planets, command.sourcePlanet);
        fleets.push(createFleet(sourcePlanet, getPlanet(planets, command.destinationPlanet), command.numberOfShips));
        sourcePlanet.numberOfShips -= command.numberOfShips;
    }
    return commands;
}

function getPlanet(planets, id) {
    return planets.filter(planet => planet.id == id)[0];
}

function calculateNextCommand(planets, fleets) {
    planets = recalculatePlanetStates(planets, fleets);
    var freePlanets = getFreePlanets(planets);
    var potentialTargets = calculatePotentialTargets(planets, fleets, freePlanets);
    if (potentialTargets.length == 0) return null;

    var target;
    var source;
    for (var i = 0; i < potentialTargets.length && !target; ++i) {
        var potentialTarget = potentialTargets[i];
        if (potentialTarget.owner == 'neutral' && potentialTarget.numberOfShips > potentialTarget.growthRate) {
            var changeState = potentialTarget.states.find(s => s.owner != 'neutral');
            if (changeState && changeState.owner == 'enemy') {
                var notTooClosePlanets = freePlanets.map(p => { return {"planet": p, "travelTime": getTravelTime(p, potentialTarget)};})
                    .sort((a, b) => a.travelTime - b.travelTime)
                    .filter(p => p.travelTime > changeState.turnsRemaining)
                    .map(p => p.planet);
                if (notTooClosePlanets.length > 0) {
                    target = potentialTarget;
                    source = notTooClosePlanets[0];
                } else {
                    continue;
                }               
            } else {
                target = potentialTarget;
                source = freePlanets[0];
            }
        } else {
            target = potentialTarget;
            source = freePlanets[0];
        }
    }
    if (!target) return null;

    var numberOfShips = getRequiredNumberOfShips(source, target, fleets);
    return createCommand(source, target, numberOfShips);
}

function createCommand(source, target, numberOfShips) {
    return {
        "sourcePlanet": source.id,
        "destinationPlanet": target.id,
        "numberOfShips": numberOfShips
    }
}

function selectTarget(potentialTargets) {
    return potentialTargets[0];
}

function selectSource(freePlanets, target) {
    return freePlanets.sort((a, b) => getTravelTime(a, target) - getTravelTime(b, target))[0];
}

function getFreePlanets(planets) {
    return planets
        .filter(p => p.owner == 'player')
        .filter(p => p.future.owner == 'player')
        .filter(p => p.future.numberOfShips > 0);
}

function isSafe(planets, fleets, target) {
    var potentialFleets = copy(fleets);
    planets.filter(planet => planet.owner == 'enemy')
        .map(planet => createFleet(planet, target, planet.numberOfShips))
        .forEach(fleet => potentialFleets.push(fleet));

    var states = calculatePlanetFuture(target, potentialFleets);
    return states[states.length - 1].owner == 'player';
}

function calculatePotentialTargets(planets, fleets, freePlanets) {
    // without free planets we can't start actions
    if (freePlanets.length == 0) return [];

    var enemyTargets = planets
        .filter(planet => planet.future.owner == 'enemy')
        .filter(enemyPlanet => {
            var fleetCopy = copy(fleets);
            freePlanets.forEach(planet => {
                var numberOfShips = getMaxNumberOfShips(planet);
                fleetCopy.push(createFleet(planet, enemyPlanet, numberOfShips));
            });
            var states = calculatePlanetFuture(enemyPlanet, fleetCopy);
            return states[states.length - 1].owner == 'player';
        })
        .sort((a, b) => b.growthRate - a.growthRate);
    
    if (enemyTargets.length > 0)
        return enemyTargets;

    var safePlanets = freePlanets.filter(planet => isSafe(planets, fleets, planet));

    return planets.filter(p => p.future.owner == 'neutral')
        .filter(neutral => {            
            var minEnemyTravelTime = Math.min(...planets.filter(enemy => enemy.owner == 'enemy')
                        .map(enemy => getTravelTime(enemy, neutral)));
            return safePlanets
                .filter(planet => planet.numberOfShips > neutral.future.numberOfShips)
                .map(planet => (minEnemyTravelTime - getTravelTime(planet, neutral)) * neutral.growthRate > neutral.future.numberOfShips ||  neutral.future.numberOfShips == neutral.growthRate)
                .some(b => b);
        })  
        .sort((a, b) => b.growthRate - a.growthRate);
}

function recalculatePlanetStates(planets, fleets) {
    planets.forEach(planet => {
        var states = calculatePlanetFuture(planet, fleets);
        planet.future = states[states.length - 1];
        planet.states = states;
    });
    return planets;
}

function getRequiredNumberOfShips(source, enemyPlanet, fleets) {
    for (var i = getMaxNumberOfShips(source) - 1; i >= 0; --i) {
        var fleetCopy = copy(fleets);
        fleetCopy.push(createFleet(source, enemyPlanet, i));
        var states = calculatePlanetFuture(enemyPlanet, fleetCopy);
        if (states[states.length - 1].owner != 'player') {
            return i + 1;
        }
    }
    return 0;
}

function getMaxNumberOfShips(planet) {
    return Math.min(Math.min(...planet.states.filter(s => s.owner == 'player').map(s => s.unnecessaryShips)), planet.numberOfShips);
}

function createFleet(source, target, numberOfShips) {
    var travelTime = getTravelTime(source, target);
    return {
        "numberOfShips": numberOfShips,
        "owner": 'player',
        "sourcePlanet": source.id,
        "targetPlanet": target.id,
        "totalTripLength": travelTime,
        "turnsRemaining": travelTime
    };
}

function copy(src) {
    return JSON.parse(JSON.stringify(src));
  }

function calculatePlanetFuture(planet, fleets) {
    var states = [];
    states.push({
        "turnsRemaining": 0,
        "numberOfShips": planet.numberOfShips,
        "unnecessaryShips": planet.numberOfShips,
        "owner": planet.owner
    });

    normalizeFleets(planet, fleets).forEach(fleet => {
        var state = states[states.length - 1];
        var numberOfShips = state.numberOfShips 
            + ((fleet.turnsRemaining - state.turnsRemaining) * planet.growthRate * (state.owner == 'neutral' ? 0 : 1))
            + (fleet.numberOfShips * (fleet.owner == state.owner ? 1 : -1));
        var normalizedNumberOfShips = numberOfShips >= 0 ? numberOfShips : -numberOfShips;
        states.push({
            "turnsRemaining": fleet.turnsRemaining,
            "numberOfShips": normalizedNumberOfShips,
            "unnecessaryShips" : state.owner != fleet.owner ? normalizedNumberOfShips - 1 : normalizedNumberOfShips,
            "owner": numberOfShips >= 0 ? state.owner : fleet.owner
        });
    });
    return states;
}

function normalizeFleets(planet, fleets) {
    var filteredFleets = fleets
        .filter(f => f.targetPlanet == planet.id)
        .sort((a, b) => a.turnsRemaining - b.turnsRemaining);

    var combinedFleets = [];
    for (var i = 0; i < filteredFleets.length; ++i) {
        var currentFleet = filteredFleets[i];
        if (combinedFleets.length == 0) {
            combinedFleets.push(copy(currentFleet));
        } else {
            var previousFleet = combinedFleets[combinedFleets.length - 1];
            if (currentFleet.turnsRemaining == previousFleet.turnsRemaining) {
                if (currentFleet.owner == previousFleet.owner) {
                    previousFleet.numberOfShips += currentFleet.numberOfShips;
                } else {
                    previousFleet.numberOfShips -= currentFleet.numberOfShips;
                    if (previousFleet.numberOfShips==0) {
                        combinedFleets.pop();
                    } else if (previousFleet.numberOfShips < 0) {
                        previousFleet.owner = currentFleet.owner;
                    }
                }
            } else {
                combinedFleets.push(copy(currentFleet)); 
            }
        }
    }
    return combinedFleets;
}

function getTravelTime(source, destination) {
    var distance = Math.ceil(Math.sqrt(
        Math.pow(destination.coordinates.x - source.coordinates.x, 2) + 
        Math.pow(destination.coordinates.y - source.coordinates.y, 2) ))
    // the speed is 1/s + 1 round to take off
    return distance + 1;    
}