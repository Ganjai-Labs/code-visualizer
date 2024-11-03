import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('CodeFlow extension activation started');

    console.log('Initializing global variables');
    console.log(`Initial panel state: ${panel ? 'exists' : 'undefined'}`);
    console.log(`Initial globalData: ${JSON.stringify(globalData)}`);
    console.log(`Initial nextNodeId: ${nextNodeId}`);
    console.log(`Initial nodePositions size: ${nodePositions.size}`);

    let disposable = vscode.commands.registerCommand('codeflow.visualize', async (uri: vscode.Uri) => {
        console.log('Command codeflow.visualize triggered');
        
        resetGlobalState(); // Add this line
        
        // Close existing panel if it exists
        if (panel) {
            panel.dispose();
            panel = undefined;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            console.log('No active editor');
            vscode.window.showErrorMessage('No active editor');
            return; 
        }

        console.log(`Active editor: ${editor.document.uri.fsPath}`);
        const position = editor.selection.active;
        console.log(`Cursor position: Line ${position.line}, Character ${position.character}`);
        const document = editor.document;

        try {
            console.log('Preparing call hierarchy');
            const callHierarchyItems = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy',
                document.uri,
                position
            );

            console.log(`Call hierarchy items: ${callHierarchyItems ? callHierarchyItems.length : 0}`);

            if (callHierarchyItems && callHierarchyItems.length > 0) {
                console.log('Call hierarchy found, generating diagram');
                console.log(`Root item: ${callHierarchyItems[0].name}`);

                console.log('Fetching incoming calls');
                const incomingCalls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                    'vscode.provideIncomingCalls',
                    callHierarchyItems[0]
                );

                console.log(`Incoming calls: ${incomingCalls ? incomingCalls.length : 0}`);

                console.log('Generating flow diagram');
                const newFlowData = await generateFlowDiagramFromCallHierarchy(callHierarchyItems[0], incomingCalls);
                console.log(`Generated new flow data: ${JSON.stringify(newFlowData)}`);

                // Merge new data with existing globalData
                mergeFlowData(newFlowData);

                console.log('Showing flow diagram');
                showFlowDiagram(globalData, context);

                console.log(`After showFlowDiagram - panel state: ${panel ? 'exists' : 'undefined'}`);
                console.log(`After showFlowDiagram - globalData: ${JSON.stringify(globalData)}`);
                console.log(`After showFlowDiagram - nextNodeId: ${nextNodeId}`);
                console.log(`After showFlowDiagram - nodePositions size: ${nodePositions.size}`);
            } else {
                console.log('No call hierarchy found');
                vscode.window.showInformationMessage('No call hierarchy found for the selected function');
            }
        } catch (error) {
            console.error('Error generating CodeFlow:', error);
            vscode.window.showErrorMessage('Error generating CodeFlow: ' + error);
        }
    });

    context.subscriptions.push(disposable);
    console.log('CodeFlow extension activation completed');
}

function getRandomPastelColor(): string {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 100%, 85%)`;
}

let panel: vscode.WebviewPanel | undefined;
let globalData: {nodes: any[], edges: any[]} = {nodes: [], edges: []};
let nextNodeId = 1;
let nodePositions: Map<number, {x: number, y: number}> = new Map();

// Modify the showFlowDiagram function
function showFlowDiagram(data: {nodes: any[], edges: any[]}, context: vscode.ExtensionContext) {
    console.log('Creating or updating webview panel');
    if (panel) {
        console.log('Updating existing panel with data:', JSON.stringify(data));
        console.log('Current node positions:', Array.from(nodePositions.entries()));
        panel.webview.postMessage({ 
            command: 'updateDiagram', 
            data: data,
            positions: Array.from(nodePositions.entries())
        });
    } else {
        console.log('Creating new panel');
        panel = vscode.window.createWebviewPanel(
            'codeFlow',
            'CodeFlow Diagram',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true
            }
        );

        panel.webview.html = getWebviewContent(data);

        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'visualize':
                        visualizeNode(message.nodeId, context);
                        return;
                    case 'goToDefinition':
                        goToDefinition(message.nodeId);
                        return;
                    case 'updatePositions':
                        nodePositions = new Map(message.positions);
                        console.log('Updated node positions:', nodePositions);
                        return;
                }
            },
            undefined,
            context.subscriptions
        );

        panel.onDidDispose(
            () => {
                panel = undefined;
                resetGlobalState(); // Added this line
            },
            null,
            context.subscriptions
        );
    }
    globalData = data;
}

// Modify visualizeNode to accept context
async function visualizeNode(nodeId: number, context: vscode.ExtensionContext) {
    const node = globalData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.file));
        // Instead of showing the document, let's just get the call hierarchy
        const position = new vscode.Position(node.line, node.character);
        
        console.log(`Requesting call hierarchy for node ${nodeId} at ${node.file}:${position.line},${position.character}`);
        const callHierarchyItems = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
            'vscode.prepareCallHierarchy',
            document.uri,
            position
        );

        if (callHierarchyItems && callHierarchyItems.length > 0) {
            const incomingCalls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                'vscode.provideIncomingCalls',
                callHierarchyItems[0]
            );

            const newData = await generateFlowDiagramFromCallHierarchy(callHierarchyItems[0], incomingCalls);
            
            // Merge the new data with existing data and update the diagram
            mergeFlowData(newData);
            showFlowDiagram(globalData, context);
        }
    } catch (error) {
        console.error('Error in visualizeNode:', error);
        vscode.window.showErrorMessage('Error visualizing node: ' + error);
    }
}

async function generateFlowDiagramFromCallHierarchy(
    item: vscode.CallHierarchyItem,
    incomingCalls: vscode.CallHierarchyIncomingCall[] | undefined
): Promise<{nodes: any[], edges: any[]}> {
    let nodes = [{
        id: 0,
        label: item.name,
        color: getRandomPastelColor(),
        file: item.uri.fsPath,
        line: item.range.start.line,
        character: item.selectionRange.start.character
    }];

    let edges: {from: number, to: number, count: number}[] = [];

    if (incomingCalls) {
        let callCounts = new Map<string, number>();
        for (let call of incomingCalls) {
            const key = `${call.from.name}-${item.name}`;
            callCounts.set(key, (callCounts.get(key) || 0) + call.fromRanges.length);
        }

        let i = 1;
        for (let [key, count] of callCounts) {
            const [fromName] = key.split('-');
            const caller = incomingCalls.find(call => call.from.name === fromName)!;
            nodes.push({
                id: i,
                label: fromName,
                color: getRandomPastelColor(),
                file: caller.from.uri.fsPath,
                line: caller.from.range.start.line,
                character: caller.from.selectionRange.start.character
            });
            edges.push({from: i, to: 0, count: count});
            i++;
        }
    }

    return {nodes, edges};
}

async function goToDefinition(nodeId: number) {
    const node = globalData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.file));
    const position = new vscode.Position(node.line, node.character);
    
    // Open the document in the active editor group (left side)
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
    
    // Move the cursor to the definition
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
}

// Modify the getWebviewContent function

/*
function showFlowDiagram(data: {nodes: any[], edges: any[]}, context: vscode.ExtensionContext) {
    console.log('Creating or updating webview panel');
    if (panel) {
        console.log('Updating existing panel');
        panel.webview.postMessage({ command: 'updateDiagram', data: data, positions: Array.from(nodePositions.entries()) });
    } else {
        console.log('Creating new panel');
        panel = vscode.window.createWebviewPanel(
            'codeFlow',
            'CodeFlow Diagram',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true
            }
        );

        panel.webview.html = getWebviewContent(data);

        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'visualize':
                        visualizeNode(message.nodeId, context);
                        return;
                    case 'goToDefinition':
                        goToDefinition(message.nodeId);
                        return;
                    case 'updatePositions':
                        nodePositions = new Map(message.positions);
                        return;
                }
            },
            undefined,
            context.subscriptions
        );

        panel.onDidDispose(
            () => {
                panel = undefined;
            },
            null,
            context.subscriptions
        );
    }
    globalData = data;
}
*/
function getWebviewContent(data: {nodes: any[], edges: any[]}) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>CodeFlow Diagram</title>
            <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
            <style type="text/css">
                body {
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                #mynetwork {
                    width: 100%;
                    height: 600px;
                    border: 1px solid var(--vscode-panel-border);
                }
                #context-menu {
                    position: absolute;
                    background-color: var(--vscode-menu-background);
                    border: 1px solid var(--vscode-menu-border);
                    border-radius: 3px;
                    padding: 5px;
                    display: none;
                    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                }
                #context-menu button {
                    display: block;
                    width: 100%;
                    padding: 5px 10px;
                    margin: 2px 0;
                    text-align: left;
                    background-color: transparent;
                    border: none;
                    color: var(--vscode-menu-foreground);
                    cursor: pointer;
                }
                #context-menu button:hover {
                    background-color: var(--vscode-menu-selectionBackground);
                    color: var(--vscode-menu-selectionForeground);
                }
            </style>
        </head>
        <body>
            <div id="mynetwork"></div>
            <div id="context-menu">
                <button id="visualize">Visualize</button>
                <button id="go-to-definition">Go to Definition</button>
            </div>
            <script type="text/javascript">
                (function() {
                    const vscode = acquireVsCodeApi();
                    let nodes = new vis.DataSet();
                    let edges = new vis.DataSet();
                    let network;
                    let selectedNode = null;
                    let lastVisualizedNode = null;
                    let nodePositions = new Map();

                    function initNetwork(data, positions) {
                        const container = document.getElementById('mynetwork');

                        // Initialize nodes and edges
                        nodes.add(data.nodes);
                        
                        // Process edges to create multiple edges for each count
                        data.edges.forEach(edge => {
                            const count = edge.count || 1;
                            for (let i = 0; i < count; i++) {
                                edges.add({
                                    from: edge.from,
                                    to: edge.to,
                                    arrows: 'to',
                                    smooth: {type: 'curvedCW', roundness: 0.2 + (i * 0.1)}
                                });
                            }
                        });

                        const dataSets = {
                            nodes: nodes,
                            edges: edges
                        };

                        const options = {
                            nodes: {
                                shape: 'box',
                                margin: 10,
                                widthConstraint: {
                                    minimum: 100,
                                    maximum: 200
                                },
                                font: {
                                    color: '#000000'
                                }
                            },
                            edges: {
                                smooth: {
                                    type: 'cubicBezier',
                                    forceDirection: 'vertical',
                                    roundness: 0.4
                                },
                                arrows: {
                                    to: { enabled: true, scaleFactor: 1 }
                                }
                            },
                            physics: {
                                enabled: false
                            },
                            interaction: {
                                dragNodes: true,
                                dragView: true,
                                zoomView: true
                            },
                            layout: {
                                improvedLayout: true,
                                hierarchical: false
                            }
                        };

                        network = new vis.Network(container, dataSets, options);

                        // Reapply positions
                        if (positions) {
                            positions.forEach(([id, pos]) => {
                                network.moveNode(id, pos.x, pos.y);
                            });
                        }

                        network.on("click", function (params) {
                            if (params.nodes.length > 0) {
                                selectedNode = params.nodes[0];
                                showContextMenu(params.pointer.DOM);
                            } else {
                                hideContextMenu();
                            }
                        });

                        network.on("dragEnd", function () {
                            const positions = network.getPositions();
                            vscode.postMessage({
                                command: 'updatePositions',
                                positions: Object.entries(positions)
                            });
                        });
                    }

                    function showContextMenu(position) {
                        const contextMenu = document.getElementById('context-menu');
                        contextMenu.style.left = position.x + 'px';
                        contextMenu.style.top = position.y + 'px';
                        contextMenu.style.display = 'block';
                    }

                    function hideContextMenu() {
                        const contextMenu = document.getElementById('context-menu');
                        contextMenu.style.display = 'none';
                        selectedNode = null;
                    }

                    document.getElementById('visualize').addEventListener('click', function() {
                        if (selectedNode !== null) {
                            lastVisualizedNode = selectedNode;
                            vscode.postMessage({
                                command: 'visualize',
                                nodeId: selectedNode
                            });
                        }
                        hideContextMenu();
                    });

                    document.getElementById('go-to-definition').addEventListener('click', function() {
                        if (selectedNode !== null) {
                            vscode.postMessage({
                                command: 'goToDefinition',
                                nodeId: selectedNode
                            });
                        }
                        hideContextMenu();
                    });

                    document.addEventListener('click', function(event) {
                        if (!event.target.closest('#context-menu') && !event.target.closest('#mynetwork')) {
                            hideContextMenu();
                        }
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateDiagram':
                                const newNodes = message.data.nodes;
                                const newEdges = message.data.edges;

                                const existingNodeIds = nodes.getIds();

                                // Add or update nodes
                                newNodes.forEach(node => {
                                    try {
                                        nodes.update(node);
                                    } catch (err) {
                                        nodes.add(node);
                                    }
                                });

                                // Clear existing edges
                                edges.clear();

                                // Add new edges
                                newEdges.forEach(edge => {
                                    const count = edge.count || 1;
                                    for (let i = 0; i < count; i++) {
                                        edges.add({
                                            from: edge.from,
                                            to: edge.to,
                                            arrows: 'to',
                                            smooth: {type: 'curvedCW', roundness: 0.2 + (i * 0.1)}
                                        });
                                    }
                                });

                                // Reapply positions
                                message.positions.forEach(([id, pos]) => {
                                    network.moveNode(id, pos.x, pos.y);
                                });

                                // Position new nodes above the selected node
                                positionNewNodes(existingNodeIds);

                                break;
                        }
                    });

                    function positionNewNodes(existingNodeIds) {
                        if (lastVisualizedNode !== null) {
                            const basePosition = network.getPositions([lastVisualizedNode])[lastVisualizedNode];

                            const currentNodeIds = nodes.getIds();
                            const newNodeIds = currentNodeIds.filter(id => !existingNodeIds.includes(id));

                            newNodeIds.forEach((id, index) => {
                                const xOffset = (index - (newNodeIds.length - 1) / 2) * 120;
                                const newPosition = {
                                    x: basePosition.x + xOffset,
                                    y: basePosition.y - 150
                                };
                                network.moveNode(id, newPosition.x, newPosition.y);
                                nodePositions.set(id, newPosition);
                            });

                            vscode.postMessage({
                                command: 'updatePositions',
                                positions: Array.from(nodePositions.entries())
                            });
                        }
                    }

                    // Initialize the network with initial data
                    initNetwork(${JSON.stringify(data)}, ${JSON.stringify(Array.from(nodePositions.entries()))});
                })();
            </script>
        </body>
        </html>
    `;
}

function mergeFlowData(newData: {nodes: any[], edges: any[]}) {
    for (const newNode of newData.nodes) {
        const existingNode = globalData.nodes.find(n => n.label === newNode.label && n.file === newNode.file);
        if (!existingNode) {
            newNode.id = nextNodeId++;
            globalData.nodes.push(newNode);
        }
    }

    for (const newEdge of newData.edges) {
        const fromNode = globalData.nodes.find(n => n.label === newData.nodes[newEdge.from].label && n.file === newData.nodes[newEdge.from].file);
        const toNode = globalData.nodes.find(n => n.label === newData.nodes[newEdge.to].label && n.file === newData.nodes[newEdge.to].file);
        if (fromNode && toNode) {
            const existingEdge = globalData.edges.find(e => e.from === fromNode.id && e.to === toNode.id);
            if (!existingEdge) {
                globalData.edges.push({ from: fromNode.id, to: toNode.id });
            }
        }
    }
}

export function deactivate() {}

function resetGlobalState() {
    globalData = {nodes: [], edges: []};
    nextNodeId = 1;
    nodePositions = new Map();
    console.log('Global state reset');
}

