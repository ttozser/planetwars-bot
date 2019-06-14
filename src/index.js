exports.handleRequest = (req, resp) => {
    console.log("request: " + JSON.stringify(req.body));

    if (!req.body.gameState) return;

    var player = req.query.player;
    var enemy = req.body.gameState.players.filter(p => p != player)[0];
    console.log("player: " + player + " enemy: " + enemy);

    var planets = req.body.gameState.planets;
    var fleets = req.body.gameState.fleets || [];

    var enemyPlanets = planets.filter(p => p.owner == enemy);
    var neutralPlanets = planets.filter(p => p.owner == "NEUTRAL");

    var commands = [];
    for (;;) {
        planets.forEach(planet => calculatePlanetFuture(planet, fleets));
        var freePlanets = planets
            .filter(p => p.owner == player)
            .filter(p => p.future.owner == player)
            .filter(p => p.future.numberOfShips > 0);
        if (freePlanets.length == 0) break;
        var source = freePlanets[0];

        var enemyPlanets = planets.sort((a, b) => b.growthRate - a.growthRate)
            .filter(planet => planet.future.owner == enemy);
        if (enemyPlanets.length == 0) break;
        var target = enemyPlanets[0];

        var numberOfShips = Math.min(source.future.numberOfShips, target.future.numberOfShips + 1);
        var travelTime = getTravelTime(source, target);
        commands.push({
            "sourcePlanet": source.id,
            "destinationPlanet": target.id,
            "numberOfShips": numberOfShips
        });
        fleets.push({
                "numberOfShips": numberOfShips,
                "owner": player,
                "sourcePlanet": source.id,
                "targetPlanet": target.id,
                "totalTripLength": travelTime,
                "turnsRemaining": travelTime
        });
        source.numberOfShips -= numberOfShips;
    }

    console.log("commands: " + JSON.stringify(commands));
    resp.status(200);
    resp.type('application/json');
    resp.send({"commands": commands});
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
            + ((fleet.turnsRemaining - state.turnsRemaining) * planet.growthRate * (planet.owner == 'NEUTRAL' ? 0 : 1))
            + (fleet.numberOfShips * (fleet.owner == planet.owner ? 1 : -1));
            states.push({
            "turnsRemaining": fleet.turnsRemaining,
            "numberOfShips": numberOfShips >= 0 ? numberOfShips : -numberOfShips,
            "owner": numberOfShips >= 0 ? state.owner : fleet.owner
        });
    });
    planet.future = states[states.length - 1];
}

function normalizeFleets(planet, fleets) {
    var filteredFleets = fleets
        .filter(f => f.targetPlanet == planet.id)
        .sort((a, b) => a.turnsRemaining - b.turnsRemaining);

    var combinedFleets = [];
    for (var i=0; i<filteredFleets.length; ++i) {
        if (combinedFleets.length == 0) {
            combinedFleets.push(filteredFleets[i]);
        } else {
            var previousFleet = combinedFleets[combinedFleets.length - 1];
            var currentFleet = filteredFleets[i];
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
            }
        }
    }
    return combinedFleets;
}

function getTravelTime(source, destination) {
    var distance = Math.ceil(Math.sqrt(
        Math.pow(destination.coordinates.x - source.coordinates.x, 2) + 
        Math.pow(destination.coordinates.y - source.coordinates.y, 2) ))
    // the speed is 1/s
    return distance;    
}