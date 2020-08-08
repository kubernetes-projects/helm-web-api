echo -e "Step 1: Deleting old wodpress..."

helm del --purge mywordpress

echo -e "Step 2: Deleting old pv and pvc... "
    kubectl delete pvc data-mywordpress-mariadb-0 mywordpress
    kubectl delete pv mysql-pv-one mysql-pv-two

echo -e "Step 3: Creating pv..."

if [[ -d /mysql/one ]]
then 
    echo -e "Directory ONE exists\n"
    sudo rm -rf /mysql/one/*
else
    echo -e "Creating directory ONE..."
    sudo mkdir -p /mysql/one
    sudo chmod 777 -R /mysql/one
fi

if [[ -d /mysql/two ]]
then 
    echo -e "Directory TWO exists\n"
    sudo rm -rf /mysql/two/*
else
    echo -e "Creating directory TWO..."
    sudo mkdir -p /mysql/two
    sudo chmod 777 -R /mysql/two
fi

kubectl apply -f pv.yaml

echo -e "Step 4: Installing wordpress helm..."
    ip=$(kubectl get svc on-demand-micro-services-deployment-on-demand-micro-services-de -o jsonpath='{.spec.clusterIP}')
    curl -d '{"chartName":"stable/wordpress", "releaseName":"mywordpress"}' -H "Content-Type: application/json" -X POST http://$ip:4000/install