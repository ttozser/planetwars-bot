exports.handleRequest = (req, resp) => {
    console.log("request: " + JSON.stringify(req.body, null, 2));

    if (!req.body.gameState) return;

    var player = req.query.player;
    var enemy = req.body.gameState.players.filter(p => p != player)[0];
    console.log("player: " + player + " enemy: " + enemy);

    var planets = req.body.gameState.planets;
    var fleets = req.body.gameState.fleets || [];

    var enemyPlanets = planets.filter(p => p.owner == enemy);
    var neutralPlanets = planets.filter(p => p.owner == "NEUTRAL");

    planets.forEach(planet => {
        var states = calculatePlanetFuture(planet, fleets);
        planet.future = states[states.length - 1];
        planet.states = states;
    });
    console.log("original prediction: " + JSON.stringify(planets, null, 2) + "\ngame: " +  req.body.gameState.id );

    var commands = [];
    for (;;) {
        planets.forEach(planet => {
            var states = calculatePlanetFuture(planet, fleets);
            planet.future = states[states.length - 1];
            planet.states = states;
        });
        var freePlanets = planets
            .filter(p => p.owner == player)
            .filter(p => p.future.owner == player)
            .filter(p => p.future.numberOfShips > 0);
        if (freePlanets.length == 0) break;

        var enemyPlanets = planets
            .filter(planet => planet.future.owner == enemy)
            .filter(enemyPlanet => {
                var fleetCopy = copy(fleets);
                freePlanets.forEach(planet => {
                    var numberOfShips = getMaxNumberOfShips(planet, player);
                    fleetCopy.push(createFleet(planet, enemyPlanet, numberOfShips, player));
                });
                var states = calculatePlanetFuture(enemyPlanet, fleetCopy);
                return states[states.length - 1].owner == player;
            })
            .sort((a, b) => b.growthRate - a.growthRate);

        if (enemyPlanets.length == 0) break;
        var target = enemyPlanets[0];

        var source = freePlanets.sort((a, b) => getTravelTime(a, target) - getTravelTime(b, target))[0];

        var numberOfShips = getMaxNumberOfShips(source, player);
        var fleet = createFleet(source, target, numberOfShips, player);
        commands.push({
            "sourcePlanet": source.id,
            "destinationPlanet": target.id,
            "numberOfShips": numberOfShips
        });
        fleets.push(fleet);
        source.numberOfShips -= numberOfShips;
    }
    console.log("final prediction: " + JSON.stringify(planets, null, 2)+ "\ngame: " +  req.body.gameState.id);

    console.log("turn: " + req.body.gameState.turn + " commands: " + JSON.stringify(commands, null, 2) + "\ngame: " +  req.body.gameState.id );
    resp.status(200);
    resp.type('application/json');
    resp.send({"commands": commands});
}

function getMaxNumberOfShips(planet, player) {
    return Math.min(Math.min(planet.states.filter(s => s.owner = player).map(s => s.numberOfShips)) + 1, planet.numberOfShips);
}

function createFleet(source, target, numberOfShips, player) {
    var travelTime = getTravelTime(source, target);
    return {
        "numberOfShips": numberOfShips,
        "owner": player,
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
        "owner": planet.owner
    });

    normalizeFleets(planet, fleets).forEach(fleet => {
        var state = states[states.length - 1];
        var numberOfShips = state.numberOfShips 
            + ((fleet.turnsRemaining - state.turnsRemaining) * planet.growthRate * (state.owner == 'NEUTRAL' ? 0 : 1))
            + (fleet.numberOfShips * (fleet.owner == state.owner ? 1 : -1));
        states.push({
            "turnsRemaining": fleet.turnsRemaining,
            "numberOfShips": numberOfShips >= 0 ? numberOfShips : -numberOfShips,
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